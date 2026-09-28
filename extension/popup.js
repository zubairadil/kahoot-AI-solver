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

      const elements = Array.from(
        document.querySelectorAll('span, div, p, fch-text')
      );

      elements.forEach(el => {
        const rect = el.getBoundingClientRect();

        if (rect.width === 0 || rect.height === 0) return;

        const computed = window.getComputedStyle(el);

        if (
          computed.display === 'none' ||
          computed.visibility === 'hidden'
        ) {
          return;
        }

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

    // HARDENED CLASSIFICATION PROMPT:
    // Ask the model for one color only, then map it back to scraped text in JavaScript.
    const prompt = `Task: Analyze the following question and select the single best color option from the available choices.

Question: ${question}

Available Choices:
${choices.Red ? `- Red: ${choices.Red}` : ''}
${choices.Blue ? `- Blue: ${choices.Blue}` : ''}
${choices.Yellow ? `- Yellow: ${choices.Yellow}` : ''}
${choices.Green ? `- Green: ${choices.Green}` : ''}

Constraint: You must output ONLY the exact color word ("Red", "Blue", "Yellow", or "Green") corresponding to the best answer. Do not include punctuation, quotes, or any extra text.

Selected Color:`;

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
            stream: false,
            options: {
              temperature: 0.0,
              stop: ["\n", "."]
            }
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Server status: ${response.status}`);
      }

      const data = await response.json();
      const cleanedColor =
        data.response.trim().replace(/[^a-zA-Z]/g, '');

      // Match the selected color back to the exact scraped answer text.
      if (choices[cleanedColor]) {
        answerView.innerHTML =
          `<span style="color: ${cleanedColor.toLowerCase()}; font-weight: bold;">` +
          `${cleanedColor}: ${choices[cleanedColor]}` +
          `</span>`;

      } else if (
        ["Red", "Blue", "Yellow", "Green"].includes(cleanedColor)
      ) {
        answerView.innerHTML =
          `<span style="color: ${cleanedColor.toLowerCase()}; font-weight: bold;">` +
          `${cleanedColor}` +
          `</span> (Text block not captured)`;

      } else {
        // Fallback in case the model ignores the single-word constraint.
        answerView.innerText = data.response.trim();
      }

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
