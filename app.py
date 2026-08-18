import os
import threading
import time
import random
from datetime import date, time as dtime, timedelta
from flask import Flask, render_template, request, jsonify
from faker import Faker
import gforms
from gforms import Form

import re

app = Flask(__name__)
faker = Faker('vi_VN')

def clean_google_form_url(url):
    if not url:
        return url
    url = url.strip()
    if '/forms/d/e/' in url:
        match = re.search(r'/forms/d/e/([^/?#\s]+)', url)
        if match:
            form_id = match.group(1)
            return f"https://docs.google.com/forms/d/e/{form_id}/viewform"
    elif '/forms/d/' in url:
        match = re.search(r'/forms/d/([^/?#\s]+)', url)
        if match:
            form_id = match.group(1)
            return f"https://docs.google.com/forms/d/{form_id}/viewform"
    return url

# Global runner state
class RunnerState:
    def __init__(self):
        self.active = False
        self.total = 0
        self.current = 0
        self.success = 0
        self.failed = 0
        self.logs = []
        self.stop_requested = False
        self.lock = threading.Lock()

    def reset(self, total):
        with self.lock:
            self.active = True
            self.total = total
            self.current = 0
            self.success = 0
            self.failed = 0
            self.logs = []
            self.stop_requested = False

    def add_log(self, message):
        with self.lock:
            timestamp = time.strftime("%H:%M:%S")
            self.logs.append(f"[{timestamp}] {message}")
            if len(self.logs) > 500:
                self.logs.pop(0)

    def stop(self):
        with self.lock:
            self.stop_requested = True

    def to_dict(self):
        with self.lock:
            return {
                "active": self.active,
                "total": self.total,
                "current": self.current,
                "success": self.success,
                "failed": self.failed,
                "logs": list(self.logs),
                "stop_requested": self.stop_requested
            }

runner_state = RunnerState()

def generate_vi_phone():
    prefixes = [
        '090', '091', '092', '093', '094', '096', '097', '098', '099', 
        '086', '088', '089', '032', '033', '034', '035', '036', '037', 
        '038', '039', '070', '076', '077', '078', '079', '081', '082', 
        '083', '084', '085'
    ]
    prefix = random.choice(prefixes)
    suffix = ''.join(random.choices('0123456789', k=7))
    return f"{prefix}{suffix}"

def generate_value_for_element(elem, config_field):
    elem_class = elem.__class__.__name__
    strategy = config_field.get('strategy', 'default')
    
    # Text or Paragraph input
    if elem_class in ['Short', 'Paragraph', 'UserEmail']:
        if strategy == 'vi_name':
            return faker.name()
        elif strategy == 'vi_phone':
            return generate_vi_phone()
        elif strategy == 'email':
            return faker.email()
        elif strategy == 'number':
            return str(random.randint(18, 60))
        elif strategy == 'text':
            return faker.sentence()
        elif strategy == 'static':
            return config_field.get('static_value', '')
        else:
            # Auto-detect from label
            name_lower = (elem.name or "").lower()
            if 'tên' in name_lower or 'name' in name_lower:
                return faker.name()
            elif 'sđt' in name_lower or 'điện thoại' in name_lower or 'phone' in name_lower:
                return generate_vi_phone()
            elif 'email' in name_lower or 'thư điện tử' in name_lower:
                return faker.email()
            elif 'tuổi' in name_lower or 'age' in name_lower:
                return str(random.randint(18, 60))
            return faker.word()

    # Radio button, Dropdown, or Linear Scale
    elif elem_class in ['Radio', 'Dropdown', 'Scale']:
        choices_cfg = config_field.get('choices', {})
        
        # Filter choices configured with positive percentages
        active_choices = {k: float(v) for k, v in choices_cfg.items() if float(v) > 0}
        
        # If no weights configured, fallback to uniform random choice
        if not active_choices:
            if hasattr(elem, 'options') and elem.options:
                opt = random.choice(elem.options)
                return opt.value
            return gforms.elements.Value.EMPTY
        
        options_list = list(active_choices.keys())
        weights_list = list(active_choices.values())
        
        chosen = random.choices(options_list, weights=weights_list, k=1)[0]
        
        # If it was the "Other" option trigger
        if chosen == '__other_option__':
            return faker.word()
        return chosen

    # Checkboxes
    elif elem_class == 'Checkboxes':
        choices_cfg = config_field.get('choices', {})
        active_choices = {k: float(v) for k, v in choices_cfg.items() if float(v) > 0}
        
        if not active_choices:
            if hasattr(elem, 'options') and elem.options:
                opt = random.choice(elem.options)
                return [opt.value]
            return gforms.elements.Value.EMPTY
            
        selected = []
        for choice_val, weight in active_choices.items():
            prob = weight / 100.0
            if random.random() < prob:
                if choice_val == '__other_option__':
                    selected.append(faker.word())
                else:
                    selected.append(choice_val)
                    
        # Force pick at least one selection if required and nothing is selected
        if elem.required and not selected:
            options_list = list(active_choices.keys())
            weights_list = list(active_choices.values())
            chosen = random.choices(options_list, weights=weights_list, k=1)[0]
            if chosen == '__other_option__':
                selected.append(faker.word())
            else:
                selected.append(chosen)
        return selected

    # Grid (RadioGrid, CheckboxGrid)
    elif elem_class in ['RadioGrid', 'CheckboxGrid']:
        rows_cfg = config_field.get('rows', {})
        selected_grid = []
        
        for row in elem.rows:
            row_cfg = rows_cfg.get(row, {})
            choices_cfg = row_cfg.get('choices', {})
            active_choices = {k: float(v) for k, v in choices_cfg.items() if float(v) > 0}
            
            if elem_class == 'RadioGrid':
                if not active_choices:
                    opt = random.choice(elem.cols)
                    selected_grid.append(opt.value)
                else:
                    options_list = list(active_choices.keys())
                    weights_list = list(active_choices.values())
                    chosen = random.choices(options_list, weights=weights_list, k=1)[0]
                    selected_grid.append(chosen)
            else:  # CheckboxGrid
                row_selected = []
                if not active_choices:
                    opt = random.choice(elem.cols)
                    row_selected.append(opt.value)
                else:
                    for choice_val, weight in active_choices.items():
                        prob = weight / 100.0
                        if random.random() < prob:
                            row_selected.append(choice_val)
                    # If required, force select at least one col
                    if elem.required and not row_selected:
                        options_list = list(active_choices.keys())
                        weights_list = list(active_choices.values())
                        chosen = random.choices(options_list, weights=weights_list, k=1)[0]
                        row_selected.append(chosen)
                selected_grid.append(row_selected)
        return selected_grid

    # Date
    elif elem_class == 'Date':
        return date.today() - timedelta(days=random.randint(0, 30))

    # Time
    elif elem_class == 'Time':
        return dtime(hour=random.randint(0, 23), minute=random.randint(0, 59))

    # Duration
    elif elem_class == 'Duration':
        return timedelta(minutes=random.randint(5, 120))

    return gforms.elements.Value.EMPTY

def submission_worker(url, count, delay, fields_config):
    global runner_state
    
    try:
        runner_state.add_log("🔄 Đang tải biểu mẫu từ Google Forms...")
        form = Form()
        form.load(url)
        
        # Check login requirements
        if form.requires_signin:
            runner_state.add_log("❌ Lỗi: Biểu mẫu yêu cầu đăng nhập tài khoản Google.")
            runner_state.add_log("💡 Vui lòng vào Cài đặt biểu mẫu (Settings) -> Tắt 'Giới hạn ở 1 câu trả lời' (Limit to 1 response) và Tắt 'Thu thập địa chỉ email' (Collect email addresses) dạng Verified.")
            runner_state.active = False
            return
            
        runner_state.add_log(f"✅ Đã kết nối biểu mẫu: \"{form.title}\"")
        runner_state.add_log(f"🚀 Bắt đầu chiến dịch tự động điền {count} lượt...")
    except Exception as e:
        runner_state.add_log(f"❌ Lỗi kết nối biểu mẫu: {str(e)}")
        runner_state.active = False
        return

    for idx in range(count):
        if runner_state.stop_requested:
            runner_state.add_log("⏹️ Đã dừng tiến trình điền biểu mẫu theo yêu cầu.")
            break
            
        runner_state.current = idx + 1
        
        try:
            form.reset()
            
            # Generate values for this iteration
            answers = {}
            for page in form.pages:
                for elem in page.elements:
                    if not isinstance(elem, gforms.elements.InputElement):
                        continue
                    config_field = fields_config.get(str(elem.id), {})
                    answers[elem.id] = generate_value_for_element(elem, config_field)
            
            # Callback function to fill the form
            def fill_callback(element, page_index, element_index):
                val = answers.get(element.id)
                if val is None:
                    return gforms.elements.Value.EMPTY
                return val
                
            form.fill(fill_callback)
            form.submit()
            
            runner_state.success += 1
            
            # Generate sample values for logging
            sample_answers = []
            for page in form.pages:
                for elem in page.elements:
                    if isinstance(elem, gforms.elements.InputElement) and elem.id in answers:
                        val = answers[elem.id]
                        val_str = str(val)[:30] + '...' if len(str(val)) > 30 else str(val)
                        sample_answers.append(f"{elem.name or 'Câu hỏi'}: {val_str}")
            
            runner_state.add_log(f"✅ Lượt #{idx + 1} thành công. Dữ liệu: {', '.join(sample_answers[:2])}")
            
        except Exception as e:
            runner_state.failed += 1
            runner_state.add_log(f"❌ Lượt #{idx + 1} thất bại: {str(e)}")
            
        # Delay between runs
        if idx < count - 1:
            time.sleep(delay)

    runner_state.active = False
    runner_state.add_log(f"🎉 Chiến dịch kết thúc! Tổng thành công: {runner_state.success}/{count}, Thất bại: {runner_state.failed}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/parse', methods=['POST'])
def parse_form():
    data = request.json
    url = clean_google_form_url(data.get('url'))
    if not url:
        return jsonify({"error": "Đường dẫn không được để trống"}), 400
        
    try:
        form = Form()
        form.load(url)
        
        serialized_pages = []
        for page in form.pages:
            serialized_elements = []
            for elem in page.elements:
                if not isinstance(elem, gforms.elements.InputElement):
                    continue
                
                elem_type = elem.__class__.__name__
                choices = []
                
                # Check for options
                if hasattr(elem, 'options') and elem.options:
                    choices = [opt.value for opt in elem.options if opt.value]
                elif hasattr(elem, 'cols') and elem.cols:
                    # For scales or tables that alias options to cols
                    choices = [opt.value for opt in elem.cols if opt.value]
                    
                has_other = False
                if hasattr(elem, 'other_option') and elem.other_option is not None:
                    has_other = True
                    
                serialized_elements.append({
                    "id": str(elem.id),
                    "name": elem.name or "Câu hỏi không có tiêu đề",
                    "description": elem.description or "",
                    "type": elem_type,
                    "required": elem.required,
                    "choices": choices,
                    "has_other": has_other,
                    "rows": elem.rows if hasattr(elem, 'rows') else []
                })
                
            if serialized_elements:
                serialized_pages.append({
                    "index": page.index,
                    "title": page.name or f"Trang {page.index + 1}",
                    "description": page.description or "",
                    "elements": serialized_elements
                })
                
        return jsonify({
            "title": form.title or form.name or "Google Form",
            "description": form.description or "",
            "requires_signin": form.requires_signin,
            "pages": serialized_pages
        })
    except Exception as e:
        return jsonify({"error": f"Không thể phân tích biểu mẫu: {str(e)}"}), 500

@app.route('/api/start', methods=['POST'])
def start_campaign():
    global runner_state
    if runner_state.active:
        return jsonify({"error": "Đang có một chiến dịch điền form đang chạy"}), 400
        
    data = request.json
    url = clean_google_form_url(data.get('url'))
    count = int(data.get('count', 10))
    delay = float(data.get('delay', 1.0))
    fields_config = data.get('fields', {})
    
    if not url:
        return jsonify({"error": "Đường dẫn biểu mẫu trống"}), 400
        
    runner_state.reset(count)
    
    # Start thread
    thread = threading.Thread(
        target=submission_worker,
        args=(url, count, delay, fields_config)
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({"status": "started"})

@app.route('/api/stop', methods=['POST'])
def stop_campaign():
    global runner_state
    runner_state.stop()
    return jsonify({"status": "stopping"})

@app.route('/api/status', methods=['GET'])
def get_status():
    global runner_state
    return jsonify(runner_state.to_dict())

if __name__ == '__main__':
    # Force templates reloading in development
    app.config['TEMPLATES_AUTO_RELOAD'] = True
    print("--------------------------------------------------")
    print(" Google Form Auto-Filler Server Running!")
    print(" Mở trình duyệt truy cập: http://127.0.0.1:5000")
    print("--------------------------------------------------")
    app.run(host='127.0.0.1', port=5000, debug=True)
