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
      // Helper function to explicitly ignore hidden screen-reader text
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);

        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0'
        ) {
          return false;
        }

        // Screen-reader text often uses absolute positioning and 1px clipping
        if (
          style.position === 'absolute' &&
          parseInt(style.width || '0') <= 1
        ) {
          return false;
        }

        if (style.clip && style.clip.includes('rect')) {
          return false;
        }

        const rect = el.getBoundingClientRect();

        if (rect.width < 5 || rect.height < 5) {
          return false;
        }

        return true;
      };

      // 1. Extract the question
      let question = "";

      const qSelectors = [
        '[data-functional-selector="question-block-title"]',
        '[data-functional-selector="block-title"]',
        'h1',
        '.question-title'
      ];

      for (let selector of qSelectors) {
        const el = document.querySelector(selector);

        if (
          el &&
          isVisible(el) &&
          el.innerText.trim().length > 3
        ) {
          question = el.innerText.trim();
          break;
        }
      }

      // 2. Extract choices using visual RGB matching
      const choices = {
        Red: "",
        Blue: "",
        Yellow: "",
        Green: ""
      };

      // Grab all potential text leaf nodes
      const elements = Array.from(
        document.querySelectorAll('span, p, div')
      );

      elements.forEach(el => {
        // Only process leaf nodes containing text
        if (el.children.length > 0) return;

        let text = (el.innerText || el.textContent || "")
          .replace(/[▲◆■●▼◄▶✖✔]/g, '')
          .trim();

        // Filter empty strings, tiny text, and screen-reader artifacts
        if (
          text.length < 2 ||
          text.includes("seconds left") ||
          text.includes("Quiz,")
        ) {
          return;
        }

        if (!isVisible(el)) return;

        let current = el;
        let colorFound = null;

        // Walk up the DOM tree until one of Kahoot's background colors is found
        while (current && current !== document.body) {
          const style = window.getComputedStyle(current);
          const bg = style.backgroundColor;

          const rgbMatch = bg.match(
            /rgba?\((\d+),\s*(\d+),\s*(\d+)/
          );

          if (rgbMatch) {
            const r = parseInt(rgbMatch[1]);
            const g = parseInt(rgbMatch[2]);
            const b = parseInt(rgbMatch[3]);

            // Fuzzy color matching (+/- 25)
            if (
              Math.abs(r - 226) < 25 &&
              Math.abs(g - 27) < 25 &&
              Math.abs(b - 60) < 25
            ) {
              colorFound = "Red";
            } else if (
              Math.abs(r - 19) < 25 &&
              Math.abs(g - 104) < 25 &&
              Math.abs(b - 206) < 25
            ) {
              colorFound = "Blue";
            } else if (
              Math.abs(r - 216) < 25 &&
              Math.abs(g - 158) < 25 &&
              b < 60
            ) {
              colorFound = "Yellow";
            } else if (
              Math.abs(r - 38) < 25 &&
              Math.abs(g - 137) < 25 &&
              Math.abs(b - 12) < 25
            ) {
              colorFound = "Green";
            }
          }

          if (colorFound) break;

          current = current.parentElement;
        }

        // Store the longest valid string found inside that colored container
        if (colorFound) {
          if (text.length > choices[colorFound].length) {
            choices[colorFound] = text;
          }
        }
      });

      return { question, choices };
    }

  }, async (results) => {
    if (!results || !results[0] || !results[0].result) {
      debugView.innerText =
        "Failed to extract elements from active tab DOM.";
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
