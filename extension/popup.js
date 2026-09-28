document.getElementById('solve-btn').addEventListener('click', async () => {
  const debugView = document.getElementById('debug-view');
  const answerView = document.getElementById('answer');

  debugView.innerText = "Scanning game canvas...";
  answerView.innerText = "Thinking...";

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab || !tab.url.includes("kahoot.it")) {
    debugView.innerText = "Error: Open a Kahoot game tab before running a scan.";
    answerView.innerText = "N/A";
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId: tab.id },

    func: () => {
      // Isolate the question block text
      const qSelectors = [
        '[data-functional-selector="question-block-title"]',
        '[data-functional-selector="block-title"]',
        'h1',
        '.question-title'
      ];

      let question = "";

      for (let selector of qSelectors) {
        const el = document.querySelector(selector);

        if (el && el.innerText.trim().length > 3) {
          question = el.innerText.trim();
          break;
        }
      }

      const choices = {
        Red: "",
        Blue: "",
        Yellow: "",
        Green: ""
      };

      // 1. Find standalone text elements first instead of broad answer containers.
      const elements = Array.from(
        document.querySelectorAll('span, div, p, fch-text')
      );

      elements.forEach(el => {
        // Skip elements without useful text or large container skeletons.
        if (!el.innerText || el.children.length > 1) return;

        const text = el.innerText
          .replace(/[▲◆■●▼◄▶✖✔]/g, '')
          .trim();

        if (text.length <= 1) return;

        // 2. Walk upward through the DOM to identify which answer block
        // contains this text.
        let current = el;
        let detectedColor = null;

        while (current && current !== document.body) {
          const html = current.outerHTML
            ? current.outerHTML.toLowerCase()
            : "";

          const entry = current.innerText
            ? current.innerText.toLowerCase()
            : "";

          if (
            html.includes("choice-0") ||
            html.includes("red") ||
            entry.includes("triangle")
          ) {
            detectedColor = "Red";
            break;
          } else if (
            html.includes("choice-1") ||
            html.includes("blue") ||
            entry.includes("diamond")
          ) {
            detectedColor = "Blue";
            break;
          } else if (
            html.includes("choice-2") ||
            html.includes("yellow") ||
            entry.includes("circle")
          ) {
            detectedColor = "Yellow";
            break;
          } else if (
            html.includes("choice-3") ||
            html.includes("green") ||
            entry.includes("square")
          ) {
            detectedColor = "Green";
            break;
          }

          current = current.parentElement;
        }

        // 3. Keep the longest valid text found for each color.
        // This avoids a smaller child container overwriting a real answer
        // with an empty or incomplete string.
        if (
          detectedColor &&
          text.toLowerCase() !== detectedColor.toLowerCase()
        ) {
          if (text.length > choices[detectedColor].length) {
            choices[detectedColor] = text;
          }
        }
      });

      return { question, choices };
    }

  }, async (results) => {
    if (!results || !results[0] || !results[0].result) {
      debugView.innerText = "Failed to extract elements from active tab DOM.";
      answerView.innerText = "N/A";
      return;
    }

    const { question, choices } = results[0].result;

    debugView.innerHTML =
      `<b>Q:</b> ${question || '<span style="color:red;">Not Detected</span>'}<br>` +
      `🔴 Red: ${choices.Red || '[Empty]'}<br>` +
      `🔵 Blue: ${choices.Blue || '[Empty]'}<br>` +
      `🟡 Yellow: ${choices.Yellow || '[Empty]'}<br>` +
      `🟢 Green: ${choices.Green || '[Empty]'}`;

    if (!question) {
      answerView.innerText = "Failed to isolate question.";
      return;
    }

    const prompt = `You are an expert multiple-choice solver. Analyze the following quiz question and select the single best option from the choices provided. Respond with ONLY the color label and the exact text of the correct answer. Do not explain your reasoning.

Question: ${question}

Choices:
- Red: ${choices.Red || 'N/A'}
- Blue: ${choices.Blue || 'N/A'}
- Yellow: ${choices.Yellow || 'N/A'}
- Green: ${choices.Green || 'N/A'}

Correct Answer:`;

    try {
      const response = await fetch(
        'http://localhost:11434/api/generate',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'llama3',
            prompt: prompt,
            stream: false
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Server responded with code: ${response.status}`);
      }

      const data = await response.json();
      answerView.innerText = data.response.trim();

    } catch (err) {
      answerView.innerHTML =
        `<span style="color:red; font-size:12px;">` +
        `Ollama Connection Error.<br>` +
        `Make sure Ollama is open and running with OLLAMA_ORIGINS="*" enabled.` +
        `</span>`;

      console.error(err);
    }
  });
});
