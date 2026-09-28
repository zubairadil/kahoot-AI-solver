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
      // Isolate the question block text safely
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

      // Target text leaf elements strictly within the visible game canvas
      const elements = Array.from(
        document.querySelectorAll('span, div, p, fch-text')
      );

      elements.forEach(el => {
        // A) Ignore hidden / non-rendered elements such as privacy or cookie text
        const rect = el.getBoundingClientRect();

        if (rect.width === 0 || rect.height === 0) return;

        const computed = window.getComputedStyle(el);

        if (
          computed.display === 'none' ||
          computed.visibility === 'hidden'
        ) {
          return;
        }

        // B) Skip container skeletons and very large text blocks
        if (
          !el.innerText ||
          el.children.length > 0 ||
          el.innerText.trim().length > 150
        ) {
          return;
        }

        const text = el.innerText
          .replace(/[▲◆■●▼◄▶✖✔]/g, '')
          .trim();

        if (text.length <= 1) return;

        // Walk upward to identify the explicit Kahoot answer container
        let current = el;
        let detectedColor = null;

        while (current && current !== document.body) {
          const funcSelector =
            current.getAttribute('data-functional-selector') || '';

          const className =
            current.className
              ? String(current.className).toLowerCase()
              : '';

          if (
            funcSelector.includes('answer-0') ||
            funcSelector.includes('choice-0') ||
            className.includes('card-0') ||
            (
              className.includes('red') &&
              funcSelector.includes('answer')
            )
          ) {
            detectedColor = "Red";
            break;

          } else if (
            funcSelector.includes('answer-1') ||
            funcSelector.includes('choice-1') ||
            className.includes('card-1') ||
            (
              className.includes('blue') &&
              funcSelector.includes('answer')
            )
          ) {
            detectedColor = "Blue";
            break;

          } else if (
            funcSelector.includes('answer-2') ||
            funcSelector.includes('choice-2') ||
            className.includes('card-2') ||
            (
              className.includes('yellow') &&
              funcSelector.includes('answer')
            )
          ) {
            detectedColor = "Yellow";
            break;

          } else if (
            funcSelector.includes('answer-3') ||
            funcSelector.includes('choice-3') ||
            className.includes('card-3') ||
            (
              className.includes('green') &&
              funcSelector.includes('answer')
            )
          ) {
            detectedColor = "Green";
            break;
          }

          current = current.parentElement;
        }

        // Keep the longest verified answer text for each color
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
        `Connection Error.<br>` +
        `Ensure Ollama is running with OLLAMA_ORIGINS="*" enabled.` +
        `</span>`;

      console.error(err);
    }
  });
});
