import keyboard
import pyautogui
import cv2
import numpy as np
import easyocr
import warnings
import ollama

warnings.filterwarnings("ignore", category=UserWarning)

# Initialize OCR reader once globally
reader = easyocr.Reader(['en'], gpu=False)


def ask_local_ai(question, choices_dict):
    c1 = choices_dict.get("Red", "N/A")
    c2 = choices_dict.get("Blue", "N/A")
    c3 = choices_dict.get("Yellow", "N/A")
    c4 = choices_dict.get("Green", "N/A")

    prompt = f"""You are an expert multiple-choice solver. Analyze the following quiz question and select the single best option from the choices provided. Respond with ONLY the color label and the exact text of the correct answer. Do not explain your reasoning.

Question: {question.strip()}

Choices:
- Red: {c1}
- Blue: {c2}
- Yellow: {c3}
- Green: {c4}

Correct Answer:"""

    print("🧠 Consulting local AI Engine...")

    try:
        response = ollama.generate(
            model='llama3',
            prompt=prompt,
            options={"num_thread": 4}
        )
        return response['response'].strip()
    except Exception as e:
        return f"AI Processing Error: {str(e)}"


def extract_and_solve_dynamic_quadrants():
    # 1. Capture screen and crop out browser top bar / taskbar clutter
    full_screenshot = pyautogui.screenshot()
    frame = cv2.cvtColor(np.array(full_screenshot), cv2.COLOR_RGB2BGR)

    h, w, _ = frame.shape

    # Crop slightly to eliminate standard taskbars, leaving the entire viewport active
    content_top = int(h * 0.05)
    content_bottom = int(h * 0.95)
    img = frame[content_top:content_bottom, 0:w].copy()
    gh, gw, _ = img.shape

    cv2.imwrite("step1_raw_game_zone.png", img)
    print("\nReading screen text elements...")

    ocr_results = reader.readtext(img)

    # Filter text entries
    valid_elements = []

    for bbox, text, prob in ocr_results:
        text = text.strip()

        # Skip small irrelevant UI text strings or systemic UI components
        if (
            len(text) <= 1
            or text.lower() in ["skip timer", "answers", "quiz", "kahoot!"]
            or text.isdigit()
        ):
            continue

        if "kahoot.it" in text.lower() or "play.kahoot.it" in text.lower():
            continue

        x_min, y_min = int(bbox[0][0]), int(bbox[0][1])
        x_max, y_max = int(bbox[2][0]), int(bbox[2][1])

        box_width = x_max - x_min
        box_height = y_max - y_min

        # CRITICAL FIX:
        # Ignore small decorative text components (usernames, icons, counters)
        if box_width < 80 and box_height < 50:
            continue

        cx = (x_min + x_max) / 2
        cy = (y_min + y_max) / 2

        valid_elements.append({
            'text': text,
            'cy': cy,
            'cx': cx,
            'bbox': (x_min, y_min, x_max, y_max)
        })

    if not valid_elements:
        print("❌ No valid text elements found on screen.")
        return

    # 2. Separate Question elements from Answer elements using screen real-estate height ratios
    question_parts = []
    answer_elements = []

    # The bottom answer container panel on Kahoot typically spans the bottom 35-40% of the game window
    answer_zone_threshold_y = gh * 0.65

    for el in valid_elements:
        # Filter out Kahoot geometric prefix markers if captured textually
        for marker in ["▲", "◆", "■", "●"]:
            el['text'] = el['text'].replace(marker, "").strip()

        if el['cy'] < answer_zone_threshold_y:
            question_parts.append(el)
        else:
            answer_elements.append(el)

    # Reconstruct the question string (sorted naturally top-to-bottom, left-to-right)
    question_parts.sort(key=lambda e: (e['cy'], e['cx']))
    question_text = " ".join([e['text'] for e in question_parts])

    # 3. Dynamic 4-Quadrant Splitting for Answers
    final_choices = {
        "Red": [],
        "Blue": [],
        "Yellow": [],
        "Green": []
    }

    mid_x = gw / 2

    # Compute the dynamic horizontal split line between the top and bottom rows of answers
    if answer_elements:
        all_answer_ys = [el['cy'] for el in answer_elements]
        mid_y = (min(all_answer_ys) + max(all_answer_ys)) / 2
    else:
        mid_y = gh * 0.82  # Fallback baseline split if zone is empty

    visual_img = img.copy()

    # Route answer strings matching geometric box grids
    for el in answer_elements:
        x_min, y_min, x_max, y_max = el['bbox']

        # Quadrant 1: Top Left -> Red Block
        if el['cx'] < mid_x and el['cy'] <= mid_y:
            final_choices["Red"].append(el['text'])
            cv2.rectangle(
                visual_img,
                (x_min, y_min),
                (x_max, y_max),
                (0, 0, 255),
                2
            )

        # Quadrant 2: Top Right -> Blue Block
        elif el['cx'] >= mid_x and el['cy'] <= mid_y:
            final_choices["Blue"].append(el['text'])
            cv2.rectangle(
                visual_img,
                (x_min, y_min),
                (x_max, y_max),
                (255, 0, 0),
                2
            )

        # Quadrant 3: Bottom Left -> Yellow Block
        elif el['cx'] < mid_x and el['cy'] > mid_y:
            final_choices["Yellow"].append(el['text'])
            cv2.rectangle(
                visual_img,
                (x_min, y_min),
                (x_max, y_max),
                (0, 255, 255),
                2
            )

        # Quadrant 4: Bottom Right -> Green Block
        elif el['cx'] >= mid_x and el['cy'] > mid_y:
            final_choices["Green"].append(el['text'])
            cv2.rectangle(
                visual_img,
                (x_min, y_min),
                (x_max, y_max),
                (0, 255, 0),
                2
            )

    cv2.imwrite("step4_routed_text.png", visual_img)

    cleaned_choices = {
        color: " ".join(words).strip()
        for color, words in final_choices.items()
    }

    print("\n--- Layout-Agnostic Extracted Game Text ---")
    print(f"Question: {question_text if question_text else '[No Question Detected]'}\n")

    for color, text in cleaned_choices.items():
        print(f"- {color}: {text if text else '[Empty]'}")

    print("------------------------------------------\n")

    if question_text:
        ai_answer = ask_local_ai(question_text, cleaned_choices)

        print("\n⚡ --- AI RECOMMENDED ANSWER --- ⚡")
        print(ai_answer)
        print("⚡ ------------------------------ ⚡\n")
    else:
        print("❌ System structural routing could not isolate a valid question string.")


print("System Active (Dynamic Quadrant Tracking Mode). Press Ctrl+Alt+T.")
keyboard.add_hotkey("ctrl+alt+t", extract_and_solve_dynamic_quadrants)
keyboard.wait()
