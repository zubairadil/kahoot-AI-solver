document.getElementById('solve-btn').addEventListener('click', async () => {
  const debugView = document.getElementById('debug-view');
  const answerView = document.getElementById('answer');

  debugView.innerText = "Scanning game canvas...";
  answerView.innerText = "Thinking...";

  // 1. Get the current active browser tab
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab || !tab.url.includes("kahoot.it")) {
    debugView.innerText = "Error: Not on a Kahoot game page.";
    answerView.innerText = "N/A";
    return;
  }

  // 2. Inject a script into the page DOM to scrape elements cleanly via test-ids
  chrome.scripting.executeScript({
    target: { tabId: tab.id },

    func: () => {
      // Kahoot relies on semantic data-functional properties or structure
      const questionEl =
        document.querySelector('[data-functional-selector="question-block-title"]');

      const question = questionEl
        ? questionEl.innerText.trim()
        : "";

      // Grab choices based on layouts using standard choice blocks
      const choices = {};
      const colors = ["red", "blue", "yellow", "green"];

      colors.forEach(color => {
        const index = colors.indexOf(color);

        const choiceEl =
          document.querySelector(
            `[data-functional-selector="answer-${index}"]`
          ) ||
          document.querySelector(`[class*="${color}"]`);

        const key =
          color.charAt(0).toUpperCase() + color.slice(1);

        if (choiceEl) {
          // Remove geometric characters if present at front
          choices[key] =
            choiceEl.innerText
              .replace(/[▲◆■●]/g, '')
              .trim();
        } else {
          choices[key] = "";
        }
      });

      return { question, choices };
    }

  }, async (results) => {
    if (!results || !results[0] || !results[0].result) {
      debugView.innerText = "Failed to extract elements from DOM.";
      return;
    }

    const { question, choices } = results[0].result;

    // Format a debug screen printout
    debugView.innerHTML =
      `<b>Q:</b> ${question || '[Not Found]'}<br>` +
      `🔴 Red: ${choices.Red || '[Empty]'}<br>` +
      `🔵 Blue: ${choices.Blue || '[Empty]'}<br>` +
      `🟡 Yellow: ${choices.Yellow || '[Empty]'}<br>` +
      `🟢 Green: ${choices.Green || '[Empty]'}`;

    if (!question) {
      answerView.innerText =
        "Could not identify question text block.";
      return;
    }

    // 3. Connect directly to your local Ollama API instance
    const prompt = `You are an expert multiple-choice solver. Analyze the following quiz question and select the single best option from the choices provided. Respond with ONLY the color label and the exact text of the correct answer. Do not explain your reasoning.

Question: ${question}

Choices:
- Red: ${choices.Red}
- Blue: ${choices.Blue}
- Yellow: ${choices.Yellow}
- Green: ${choices.Green}

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

      const data = await response.json();
      answerView.innerText = data.response.trim();

    } catch (err) {
      answerView.innerText =
        "Connection Error to Ollama (Ensure it's running locally with CORS allowed).";

      console.error(err);
    }
  });
});
