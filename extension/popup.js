document.getElementById('solve-btn').addEventListener('click', async () => {
  const debugView = document.getElementById('debug-view');
  const answerView = document.getElementById('answer');

  debugView.innerText = "Scanning game canvas...";
  answerView.innerText = "Thinking...";

  // 1. Fetch the active web tab context
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab || !tab.url.includes("kahoot.it")) {
    debugView.innerText = "Error: Open a Kahoot game tab before running a scan.";
    answerView.innerText = "N/A";
    return;
  }

  // 2. Execute DOM scraping within the active page target
  chrome.scripting.executeScript({
    target: { tabId: tab.id },

    func: () => {
      // Robust structural selectors for isolating the query title
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

      // Initialize clean four-color dictionary mappings
      const choices = {
        Red: "",
        Blue: "",
        Yellow: "",
        Green: ""
      };

      // Query structural elements that Kahoot uses to present multiple-choice buttons
      const cardElements = document.querySelectorAll(
        '[data-functional-selector^="answer-"], ' +
        '[data-functional-selector^="multi-select-button-"], ' +
        '[class*="card-"], [class*="answer-"], [role="button"]'
      );

      cardElements.forEach(el => {
        const htmlText = el.outerHTML.toLowerCase();
        let detectedColor = null;

        // Map the structural layout nodes to specific colors using explicit design properties
        if (
          htmlText.includes("red") ||
          htmlText.includes("triangle") ||
          htmlText.includes("choice-0")
        ) {
          detectedColor = "Red";
        } else if (
          htmlText.includes("blue") ||
          htmlText.includes("diamond") ||
          htmlText.includes("choice-1")
        ) {
          detectedColor = "Blue";
        } else if (
          htmlText.includes("yellow") ||
          htmlText.includes("circle") ||
          htmlText.includes("choice-2")
        ) {
          detectedColor = "Yellow";
        } else if (
          htmlText.includes("green") ||
          htmlText.includes("square") ||
          htmlText.includes("choice-3")
        ) {
          detectedColor = "Green";
        }

        if (detectedColor && el.innerText.trim().length > 0) {
          // FIX: only strip geometric Unicode characters.
          // Normal letters such as a, t and v are preserved.
          let cleanText = el.innerText
            .replace(/[▲◆■●▼◄▶✖✔]/g, '')
            .trim();

          // Ignore standalone structural color labels
          if (
            cleanText.toLowerCase() !== detectedColor.toLowerCase() &&
            cleanText.length > 0
          ) {
            choices[detectedColor] = cleanText;
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

    // Update popup debugging display
    debugView.innerHTML =
      `<b>Q:</b> ${question || '<span style="color:red;">Not Detected</span>'}<br>` +
      `🔴 Red: ${choices.Red || '[Empty]'}<br>` +
      `🔵 Blue: ${choices.Blue || '[Empty]'}<br>` +
      `🟡 Yellow: ${choices.Yellow || '[Empty]'}<br>` +
      `🟢 Green: ${choices.Green || '[Empty]'}`;

    if (!question) {
      answerView.innerText =
        "Failed to isolate question. Ensure a quiz query is visible on the screen framework.";
      return;
    }

    // 3. Assemble structural prompt payload context for the LLM
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
        `Make sure Ollama is open and running in your shell environment ` +
        `with OLLAMA_ORIGINS="*" enabled.` +
        `</span>`;

      console.error(err);
    }
  });
});
