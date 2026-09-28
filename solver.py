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


def extract_and_solve_dynamic_rows():
    # 1. Capture screen and crop out browser top bar / taskbar clutter
    full_screenshot = pyautogui.screenshot()
    frame = cv2.cvtColor(np.array(full_screenshot), cv2.COLOR_RGB2BGR)

    h, w, _ = frame.shape
    content_top = int(h * 0.15)
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

        if (
            len(text) <= 1
            or text.lower() in ["skip timer", "answers", "quiz", "kahoot!"]
            or text.isdigit()
        ):
            continue

        if "kahoot.it" in text.lower():
            continue

        x_min, y_min = int(bbox[0][0]), int(bbox[0][1])
        x_max, y_max = int(bbox[2][0]), int(bbox[2][1])

        cx = (x_min + x_max) / 2
        cy = (y_min + y_max) / 2

        valid_elements.append({
            'text': text,
            'cy': cy,
            'cx': cx,
            'bbox': (x_min, y_min, x_max, y_max)
        })

    if not valid_elements:
        print("❌ No text elements found on screen.")
        return

    # 2. Cluster text elements into horizontal rows based on Y-coordinate proximity
    valid_elements.sort(key=lambda e: e['cy'])

    rows = []
    threshold_y = 25

    for el in valid_elements:
        placed = False

        for row in rows:
            avg_y = sum([item['cy'] for item in row]) / len(row)

            if abs(el['cy'] - avg_y) < threshold_y:
                row.append(el)
                placed = True
                break

        if not placed:
            rows.append([el])

    for row in rows:
        row.sort(key=lambda e: e['cx'])

    # 3. Separate bottom answer rows from question rows
    answer_rows = rows[-2:] if len(rows) >= 2 else rows[-1:]
    question_rows = rows[:-2] if len(rows) >= 2 else []

    question_parts = []

    for q_row in question_rows:
        for el in q_row:
            if any(char.isdigit() or char == '%' for char in el['text']):
                continue
            question_parts.append(el['text'])

    question_text = " ".join(question_parts)

    # 4. Map the choices based on layout quadrants
    final_choices = {"Red": [], "Blue": [], "Yellow": [], "Green": []}
    mid_x = gw / 2
    visual_img = img.copy()

    # Row 1: Red / Blue
    if len(answer_rows) >= 1:
        for el in answer_rows[0]:
            x_min, y_min, x_max, y_max = el['bbox']

            if el['cx'] < mid_x:
                final_choices["Red"].append(el['text'])
                cv2.rectangle(visual_img, (x_min, y_min), (x_max, y_max), (0, 0, 255), 2)
            else:
                final_choices["Blue"].append(el['text'])
                cv2.rectangle(visual_img, (x_min, y_min), (x_max, y_max), (255, 0, 0), 2)

    # Row 2: Yellow / Green
    if len(answer_rows) == 2:
        for el in answer_rows[1]:
            x_min, y_min, x_max, y_max = el['bbox']

            if el['cx'] < mid_x:
                final_choices["Yellow"].append(el['text'])
                cv2.rectangle(visual_img, (x_min, y_min), (x_max, y_max), (0, 255, 255), 2)
            else:
                final_choices["Green"].append(el['text'])
                cv2.rectangle(visual_img, (x_min, y_min), (x_max, y_max), (0, 255, 0), 2)

    cv2.imwrite("step4_routed_text.png", visual_img)

    cleaned_choices = {
        color: " ".join(words)
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
        print("❌ Dynamic row tracking could not isolate a clean question string.")


print("System Active (Dynamic Cluster Mode). Press Ctrl+Alt+T.")
keyboard.add_hotkey("ctrl+alt+t", extract_and_solve_dynamic_rows)
keyboard.wait()
