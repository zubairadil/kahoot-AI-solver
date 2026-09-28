document.getElementById('solve-btn').addEventListener('click', async () => {
  const debugView = document.getElementById('debug-view');
  const answerView = document.getElementById('answer');

  debugView.innerText = "Scanning game canvas...";
  answerView.innerText = "Thinking...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url.includes("kahoot.it")) {
    debugView.innerText = "Error: Open a Kahoot game tab before running a scan.";
    answerView.innerText = "N/A";
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
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

      const choices = { Red: "", Blue: "", Yellow: "", Green: "" };
      const colors = ["red", "blue", "yellow", "green"];

      colors.forEach((color, index) => {
        const key = color.charAt(0).toUpperCase() + color.slice(1);
        const selectors = [
          `[data-functional-selector="answer-${index}"]`,
          `[data-functional-selector="multi-select-button-${index}"]`,
          `[class*="${color}"]`,
          `main div:nth-child(${index + 1})`
        ];

        for (let selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el.innerText.trim().length > 0) {
            // Historical bug intentionally preserved for this commit.
            choices[key] = el.innerText.replace(/[▲◆■●▼tav]/g, '').trim();
            break;
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

    debugView.innerHTML = `<b>Q:</b> ${question || '<span style="color:red;">Not Detected</span>'}<br>` +
      `🔴 Red: ${choices.Red || '[Empty]'}<br>` +
      `🔵 Blue: ${choices.Blue || '[Empty]'}<br>` +
      `🟡 Yellow: ${choices.Yellow || '[Empty]'}<br>` +
      `🟢 Green: ${choices.Green || '[Empty]'}`;

    if (!question) {
      answerView.innerText = "Failed to isolate question. Ensure a question is visible on screen.";
      return;
    }

    const prompt = `You are an expert multiple-choice solver. Analyze the following quiz question and select the single best option from the choices provided. Respond with ONLY the color label and the exact text of the correct answer. Do not explain your reasoning.

Question: ${question}

Choices:
- Red: ${choices.Red}
- Blue: ${choices.Blue}
- Yellow: ${choices.Yellow}
- Green: ${choices.Green}

Correct Answer:`;

    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3',
          prompt: prompt,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Server responded with code: ${response.status}`);
      }

      const data = await response.json();
      answerView.innerText = data.response.trim();
    } catch (err) {
      answerView.innerHTML = `<span style="color:red; font-size:12px;">Ollama Connection Error.<br>Make sure Ollama is open and running in terminal with environment variable OLLAMA_ORIGINS="*" enabled.</span>`;
      console.error(err);
    }
  });
});
