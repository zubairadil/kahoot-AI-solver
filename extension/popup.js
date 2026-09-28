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
      // Find the question text safely
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

      // Target choice blocks directly instead of scanning every text node globally
      const blocks = document.querySelectorAll(
        '[data-functional-selector^="answer-"], ' +
        '[class*="answer-card"], ' +
        '[class*="ChoiceOutcomeButton"]'
      );

      blocks.forEach(block => {
        const textEl = block.querySelector(
          '[data-functional-selector="card-title"], span, p, div'
        );

        if (!textEl) return;

        let rawText = textEl.innerText || "";

        // Clean out layout shape icons from text strings
        let cleanText = rawText
          .replace(/[▲◆■●▼◄▶✖✔]/g, '')
          .trim();

        if (!cleanText) return;

        // Determine the actual layout color based on Kahoot design tokens
        const htmlStr = block.outerHTML.toLowerCase();
        const style = window.getComputedStyle(block);
        const bg = style.backgroundColor;

        if (
          htmlStr.includes('red') ||
          htmlStr.includes('triangle') ||
          bg.includes('226, 27') ||
          bg.includes('rgb(226,')
        ) {
          choices.Red = cleanText;

        } else if (
          htmlStr.includes('blue') ||
          htmlStr.includes('diamond') ||
          bg.includes('19, 104') ||
          bg.includes('rgb(19,')
        ) {
          choices.Blue = cleanText;

        } else if (
          htmlStr.includes('yellow') ||
          htmlStr.includes('circle') ||
          bg.includes('216, 158') ||
          bg.includes('rgb(216,')
        ) {
          choices.Yellow = cleanText;

        } else if (
          htmlStr.includes('green') ||
          htmlStr.includes('square') ||
          bg.includes('38, 137') ||
          bg.includes('rgb(38,')
        ) {
          choices.Green = cleanText;
        }
      });

      // Fallback: if direct layout blocks do not match, inspect nearby
      // leaf text and infer color from shape / answer markers.
      if (
        !choices.Red &&
        !choices.Blue &&
        !choices.Yellow &&
        !choices.Green
      ) {
        const fallbackItems = Array.from(
          document.querySelectorAll('span, p, div')
        );

        fallbackItems.forEach(el => {
          if (el.children.length > 0 || !el.innerText) return;

          const txt = el.innerText
            .replace(/[▲◆■●▼◄▶✖✔]/g, '')
            .trim();

          if (txt.length < 2) return;

          const parentStr = el.parentElement
            ? el.parentElement.outerHTML.toLowerCase()
            : '';

          if (
            parentStr.includes('triangle') ||
            parentStr.includes('answer-0')
          ) {
            choices.Red = txt;

          } else if (
            parentStr.includes('diamond') ||
            parentStr.includes('answer-1')
          ) {
            choices.Blue = txt;

          } else if (
            parentStr.includes('circle') ||
            parentStr.includes('answer-2')
          ) {
            choices.Yellow = txt;

          } else if (
            parentStr.includes('square') ||
            parentStr.includes('answer-3')
          ) {
            choices.Green = txt;
          }
        });
      }

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

    // Direct, strict multiple-choice solver prompt format
    const prompt = `Task: Select the historically or technically correct multiple choice option.

Question: ${question}

Available options to choose from:
${choices.Red ? `- Red: ${choices.Red}` : ''}
${choices.Blue ? `- Blue: ${choices.Blue}` : ''}
${choices.Yellow ? `- Yellow: ${choices.Yellow}` : ''}
${choices.Green ? `- Green: ${choices.Green}` : ''}

Instruction: Output exactly one word from this list: Red, Blue, Yellow, Green. Do not write full sentences or explanations.

Answer:`;

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
              stop: ["\n", ".", " ", ","]
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
