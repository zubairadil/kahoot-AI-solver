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
          el.innerText.trim().length > 100
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
          // Inspect the computed style and structural metadata instead of
          // relying only on fixed answer indexes.
          const style = window.getComputedStyle(current);
          const bg = style.backgroundColor;

          const className =
            current.className
              ? String(current.className).toLowerCase()
              : '';

          const funcSelector =
            current.getAttribute('data-functional-selector') || '';

          const combinedStr = className + " " + funcSelector;

          if (
            bg.includes('rgb(226, 27, 60)') ||
            combinedStr.includes('red') ||
            (
              combinedStr.includes('answer-0') &&
              !document.querySelector(
                '[data-functional-selector*="answer-2"]'
              )
            )
          ) {
            // Historical True/False special case.
            if (
              combinedStr.includes('answer-0') &&
              document.body.innerText.includes('True\nFalse')
            ) {
              detectedColor = "Blue";
            } else {
              detectedColor = "Red";
            }
          }

          // Primary color checking fallbacks.
          if (
            combinedStr.includes('red') ||
            combinedStr.includes('card-0') ||
            bg.includes('226, 27')
          ) {
            detectedColor = "Red";

          } else if (
            combinedStr.includes('blue') ||
            combinedStr.includes('card-1') ||
            bg.includes('19, 104')
          ) {
            detectedColor = "Blue";

          } else if (
            combinedStr.includes('yellow') ||
            combinedStr.includes('card-2') ||
            bg.includes('216, 158')
          ) {
            detectedColor = "Yellow";

          } else if (
            combinedStr.includes('green') ||
            combinedStr.includes('card-3') ||
            bg.includes('38, 137')
          ) {
            detectedColor = "Green";
          }

          // True/False edge-case override verification.
          if (
            funcSelector.includes('answer-0') &&
            !document.querySelector(
              '[data-functional-selector*="answer-2"]'
            )
          ) {
            detectedColor = "Blue";
          } else if (
            funcSelector.includes('answer-1') &&
            !document.querySelector(
              '[data-functional-selector*="answer-2"]'
            )
          ) {
            detectedColor = "Red";
          }

          if (detectedColor) break;

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

    // Ultra-short prompt optimized for a small local model.
    const prompt = `Choose the best answer for the question. Respond with ONLY the color name: Red, Blue, Yellow, or Green. Nothing else.

Question: ${question}

Red: ${choices.Red || 'N/A'}
Blue: ${choices.Blue || 'N/A'}
Yellow: ${choices.Yellow || 'N/A'}
Green: ${choices.Green || 'N/A'}

Color:`;

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
              stop: ["\n", ".", " "]
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

      if (choices[cleanedColor]) {
        answerView.innerHTML =
          `<span style="color: ${cleanedColor.toLowerCase()}; font-weight: bold; font-size: 20px;">` +
          `${cleanedColor}: ${choices[cleanedColor]}` +
          `</span>`;
      } else {
        answerView.innerText =
          cleanedColor || data.response.trim();
      }

    } catch (err) {
      answerView.innerHTML =
        `<span style="color:red; font-size:12px;">` +
        `Connection Error.` +
        `</span>`;

      console.error(err);
    }
  });
});
