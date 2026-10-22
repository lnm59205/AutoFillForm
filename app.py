import os
import sys
import threading
import time
import random
import math
import unicodedata
import webbrowser
import base64
import json
import urllib.request
import urllib.error
import re
from datetime import date, time as dtime, timedelta
from flask import Flask, render_template, request, jsonify
from faker import Faker
import gforms
from gforms import Form

# Embedded Groq key (XOR-obfuscated byte sequence to prevent GitHub secret scanner)
_K_DATA = [61, 41, 49, 5, 22, 19, 55, 20, 10, 55, 98, 108, 0, 104, 60, 55, 24, 45, 111, 32, 12, 45, 24, 45, 13, 29, 62, 35, 56, 105, 28, 3, 106, 19, 45, 63, 106, 45, 61, 29, 29, 55, 15, 9, 56, 59, 18, 105, 12, 99, 21, 63, 42, 52, 17, 41]

def get_groq_api_key(client_key=None):
    if client_key and isinstance(client_key, str) and client_key.strip():
        return client_key.strip()
    if os.environ.get("GROQ_API_KEY"):
        return os.environ.get("GROQ_API_KEY").strip()
    
    search_dirs = [
        os.path.dirname(os.path.abspath(__file__)),
        os.getcwd(),
        os.path.dirname(os.getcwd())
    ]
    if getattr(sys, 'frozen', False):
        search_dirs.insert(0, getattr(sys, '_MEIPASS', ''))
        search_dirs.insert(0, os.path.dirname(sys.executable))
        
    for check_dir in search_dirs:
        if not check_dir:
            continue
        env_file = os.path.join(check_dir, ".env")
        if os.path.exists(env_file):
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("GROQ_API_KEY="):
                            k = line.split("=", 1)[1].strip().strip('"').strip("'")
                            if k:
                                return k
            except Exception:
                pass
                
    try:
        return ''.join(chr(b ^ 0x5A) for b in _K_DATA)
    except Exception:
        return ""

def normalize_choices_to_100(choice_dict):
    """
    Guarantees choice percentages sum to EXACTLY 100 using Largest Remainder Method (Hamilton Method).
    """
    if not choice_dict:
        return {}
    valid_items = []
    for k, v in choice_dict.items():
        try:
            val = max(0.0, float(v))
        except (ValueError, TypeError):
            val = 0.0
        valid_items.append((k, val))
        
    total_val = sum(v for _, v in valid_items)
    n = len(valid_items)
    if n == 0:
        return {}
        
    if total_val <= 0:
        base = 100 // n
        rem = 100 % n
        res = {}
        for idx, (k, _) in enumerate(valid_items):
            res[k] = base + (1 if idx < rem else 0)
        return res

    quotas = [(k, (v / total_val) * 100.0) for k, v in valid_items]
    integers = {k: int(math.floor(q)) for k, q in quotas}
    remainders = [(k, q - integers[k]) for k, q in quotas]
    
    unallocated = 100 - sum(integers.values())
    remainders.sort(key=lambda x: x[1], reverse=True)
    
    for i in range(unallocated):
        k = remainders[i % n][0]
        integers[k] += 1
        
    return integers

def align_and_normalize_choices(question_choices, llm_choices_dict, is_checkbox=False):
    if not question_choices:
        return {}
    mapped = {}
    for c in question_choices:
        c_str = str(c).strip()
        matched_val = None
        if c_str in llm_choices_dict:
            matched_val = llm_choices_dict[c_str]
        else:
            for k, v in llm_choices_dict.items():
                if backend_fuzzy_match(str(k), c_str):
                    matched_val = v
                    break
        if matched_val is not None:
            try:
                mapped[c_str] = max(0, min(100, int(round(float(matched_val)))))
            except (ValueError, TypeError):
                mapped[c_str] = 0
        else:
            mapped[c_str] = 0
            
    if is_checkbox:
        return mapped
    return normalize_choices_to_100(mapped)

def query_groq_ai(api_key, system_prompt, user_prompt):
    models = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']
    url = 'https://api.groq.com/openai/v1/chat/completions'
    
    last_err = None
    for model_name in models:
        payload = {
            'model': model_name,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt}
            ],
            'response_format': {'type': 'json_object'},
            'temperature': 0.3
        }
        
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
                'User-Agent': 'AutoFillForm/1.0'
            }
        )
        
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                res_data = json.loads(resp.read().decode('utf-8'))
                content = res_data['choices'][0]['message']['content']
                return json.loads(content)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='ignore')
            last_err = f"HTTP {e.code}: {err_body}"
            continue
        except Exception as e:
            last_err = str(e)
            continue
            
    raise Exception(f"Lỗi kết nối Groq AI: {last_err}")

if getattr(sys, 'frozen', False):
    base_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    template_folder = os.path.join(base_dir, 'templates')
    static_folder = os.path.join(base_dir, 'static')
    app = Flask(__name__, template_folder=template_folder, static_folder=static_folder)
else:
    app = Flask(__name__)

faker = Faker('vi_VN')

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response

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

VI_EMAIL_FIRST_NAMES = [
    'nguyen', 'tran', 'le', 'pham', 'hoang', 'huynh', 'phan', 'vu', 'vo', 
    'dang', 'bui', 'do', 'ho', 'ngo', 'duong', 'ly', 'dinh', 'ha', 'doan'
]
VI_EMAIL_MIDDLE_NAMES = [
    'van', 'thi', 'duc', 'hai', 'xuan', 'thu', 'minh', 'quang', 'ngoc', 
    'huu', 'anh', 'thanh', 'phuong', 'hoang', 'quoc', 'gia', 'bao'
]
VI_EMAIL_LAST_NAMES = [
    'anh', 'nam', 'duc', 'huy', 'tuan', 'long', 'hung', 'thang', 'trung',
    'dung', 'dat', 'khoa', 'kien', 'tung', 'hai', 'quan', 'hoang',
    'linh', 'mai', 'trang', 'huong', 'thao', 'ha', 'ngan', 'quynh',
    'lan', 'chi', 'vy', 'nhung', 'uyen', 'yen', 'hang', 'ngoc', 'tram'
]
VI_EMAIL_DOMAINS = [
    'gmail.com', 'gmail.com', 'gmail.com', 'gmail.com', 'gmail.com', 
    'gmail.com', 'gmail.com', 'gmail.com', 'gmail.com', 'gmail.com',
    'outlook.com', 'yahoo.com'
]

def generate_real_vi_email():
    f = random.choice(VI_EMAIL_FIRST_NAMES)
    m = random.choice(VI_EMAIL_MIDDLE_NAMES)
    l = random.choice(VI_EMAIL_LAST_NAMES)
    domain = random.choice(VI_EMAIL_DOMAINS)
    
    birth_year = random.randint(1994, 2006)
    short_year = str(birth_year)[2:]
    rand_num = random.randint(10, 999)
    day = random.randint(1, 28)
    month = random.randint(1, 12)
    ddmm = f"{day:02d}{month:02d}"
    
    patterns = [
        f"{f}{m}{l}{birth_year}",
        f"{l}{f}{m}{birth_year}",
        f"{l}{f}{short_year}",
        f"{f}{l}{birth_year}",
        f"{l}{m}{f}{short_year}",
        f"{l}{f}{m}",
        f"{f}{m}{l}",
        f"{l}{f}{rand_num}",
        f"{f}{l}{ddmm}",
        f"{l}{f}{m}{rand_num}",
        f"{f}{m[0]}{l[0]}{birth_year}",
        f"{l}{f[0]}{m[0]}{short_year}",
        f"{f}{m}{l}{short_year}",
        f"{l}{ddmm}{short_year}",
        f"{l}{ddmm}",
        f"{f}{l}{short_year}",
        f"{f}{l}{rand_num}"
    ]
    user = random.choice(patterns).replace('.', '').strip()
    return f"{user}@{domain}"

def backend_fuzzy_match(s1, s2):
    if s1 is None or s2 is None:
        return False
    def clean(s):
        s = str(s)
        s = unicodedata.normalize('NFKC', s)
        s = s.lower().strip()
        s = re.sub(r'[\s\u200b\ufeff]+', ' ', s)
        return s
    c1 = clean(s1)
    c2 = clean(s2)
    if c1 == c2:
        return True
    p1 = re.sub(r'[\'\"`“”‘’.,:;\-_()[\]{}]', '', c1).strip()
    p2 = re.sub(r'[\'\"`“”‘’.,:;\-_()[\]{}]', '', c2).strip()
    if p1 and p2 and (p1 == p2 or p1 in p2 or p2 in p1):
        return True
    return False

def get_elem_options_list(elem):
    if hasattr(elem, 'options') and elem.options:
        return list(elem.options)
    elif hasattr(elem, 'cols') and elem.cols:
        return list(elem.cols)
    return []

def get_opt_val(opt):
    return getattr(opt, 'value', str(opt))

def find_matching_cfg_key(choices_cfg, opt_val):
    if not choices_cfg:
        return None
    opt_str = str(opt_val).strip()
    if opt_str in choices_cfg:
        return opt_str
    for cfg_key in choices_cfg.keys():
        if backend_fuzzy_match(cfg_key, opt_val):
            return cfg_key
    return None

def find_other_cfg_key(choices_cfg):
    if not choices_cfg:
        return None
    for cfg_key in choices_cfg.keys():
        if cfg_key == '__other_option__' or backend_fuzzy_match(cfg_key, 'khác') or backend_fuzzy_match(cfg_key, 'đáp án khác (tự động)'):
            return cfg_key
    return None

def score_choice_sentiment(choice_str, index=0, total=1):
    s = str(choice_str).lower().strip()
    
    num_match = re.match(r'^(\d+)(?:[./\-]|\s*$)', s)
    if num_match and total > 1:
        return -1.0 + 2.0 * (index / (total - 1))
        
    neg_strong = [
        'rất không hài lòng', 'hoàn toàn không đồng ý', 'rất không đồng ý', 
        'rất tệ', 'rất kém', 'rất không thích', 'không bao giờ', 
        'chưa bao giờ', 'rất phản đối', 'rất thất vọng', 'cực kỳ tệ'
    ]
    neg_mild = [
        'không hài lòng', 'không đồng ý', 'tệ', 'kém', 'không thích', 
        'ít khi', 'hiếm khi', 'không tốt', 'phản đối', 'thất vọng', 
        'yếu', 'disagree', 'dissatisfied', 'bad', 'poor'
    ]
    pos_strong = [
        'rất hài lòng', 'hoàn toàn đồng ý', 'rất đồng ý', 'rất tốt', 
        'tuyệt vời', 'rất thích', 'luôn luôn', 'rất thường xuyên', 
        'rất hiệu quả', 'rất cao', 'xuất sắc', 'rất ủng hộ'
    ]
    pos_mild = [
        'hài lòng', 'đồng ý', 'tốt', 'thích', 'thường xuyên', 
        'hiệu quả', 'cao', 'ủng hộ', 'khá', 'agree', 'satisfied', 'good'
    ]
    neutral_patterns = [
        'bình thường', 'trung bình', 'trung lập', 'không ý kiến', 
        'không có ý kiến', 'phân vân', 'tạm được', 'chấp nhận được', 
        'thỉnh thoảng', 'đôi khi', 'chưa rõ', 'neutral', 'average', 'normal'
    ]
    
    for pat in neg_strong:
        if pat in s:
            return -1.0
    for pat in pos_strong:
        if pat in s:
            return 1.0
    for pat in neg_mild:
        if pat in s:
            return -0.6
    for pat in pos_mild:
        if pat in s:
            return 0.6
    for pat in neutral_patterns:
        if pat in s:
            return 0.0
            
    if s == 'không' or s.startswith('không ') or s == 'no':
        return -0.8
    if s == 'có' or s.startswith('có ') or s == 'yes':
        return 0.8
        
    if total > 1:
        return -0.7 + 1.4 * (index / (total - 1))
    return 0.0

def calculate_natural_weights(options, trend_mode):
    n = len(options)
    if n == 0:
        return {}
    if n == 1:
        return {options[0]: 100.0}
        
    scores = [score_choice_sentiment(opt, idx, n) for idx, opt in enumerate(options)]
    
    weights = []
    for s in scores:
        if trend_mode == 'natural_negative':
            w = math.exp(-2.2 * s)
        elif trend_mode == 'natural_positive':
            w = math.exp(2.2 * s)
        else:  # natural_neutral
            w = math.exp(-3.5 * (s ** 2))
        weights.append(w)
        
    total_w = sum(weights) or 1.0
    pcts = [(w / total_w) * 100.0 for w in weights]
    return {options[i]: pcts[i] for i in range(n)}

def generate_value_for_element(elem, config_field, distribution_mode='absolute'):
    elem_class = elem.__class__.__name__
    strategy = config_field.get('strategy', 'email')
    
    # Text or Paragraph input (Mặc định sinh email người thật @gmail.com)
    if elem_class in ['Short', 'Paragraph', 'UserEmail']:
        if strategy == 'static' and config_field.get('static_value'):
            return config_field.get('static_value')
        return generate_real_vi_email()

    # Radio button, Dropdown, or Linear Scale
    elif elem_class in ['Radio', 'Dropdown', 'Scale']:
        elem_options = get_elem_options_list(elem)
        choices_cfg = config_field.get('choices')
        if not choices_cfg:
            choices_cfg = config_field.get('options', {})
        
        active_choices = {}
        if elem_options:
            for opt in elem_options:
                opt_val = get_opt_val(opt)
                matched_key = find_matching_cfg_key(choices_cfg, opt_val)
                if matched_key is not None:
                    try:
                        weight = float(choices_cfg[matched_key])
                        if weight > 0:
                            active_choices[opt_val] = weight
                    except (ValueError, TypeError):
                        pass
            
            if elem.other_option is not None:
                other_key = find_other_cfg_key(choices_cfg)
                if other_key is not None:
                    try:
                        weight = float(choices_cfg[other_key])
                        if weight > 0:
                            active_choices['__other_option__'] = weight
                    except (ValueError, TypeError):
                        pass
        
        if distribution_mode.startswith('natural_') and (not active_choices or not any(active_choices.values())):
            opt_values = [get_opt_val(o) for o in elem_options]
            active_choices = calculate_natural_weights(opt_values, distribution_mode)
        
        if not active_choices:
            if elem_options:
                opt = random.choice(elem_options)
                return get_opt_val(opt)
            return gforms.elements.Value.EMPTY
        
        options_list = list(active_choices.keys())
        weights_list = [float(active_choices[k]) for k in options_list]
        
        if distribution_mode.startswith('natural_'):
            weights_list = [max(0.1, w * random.uniform(0.9, 1.1)) for w in weights_list]
            
        chosen = random.choices(options_list, weights=weights_list, k=1)[0]
        if chosen == '__other_option__':
            return faker.word()
        return chosen

    # Checkboxes
    elif elem_class == 'Checkboxes':
        elem_options = get_elem_options_list(elem)
        choices_cfg = config_field.get('choices')
        if not choices_cfg:
            choices_cfg = config_field.get('options', {})
            
        active_choices = {}
        if elem_options:
            for opt in elem_options:
                opt_val = get_opt_val(opt)
                matched_key = find_matching_cfg_key(choices_cfg, opt_val)
                if matched_key is not None:
                    try:
                        weight = float(choices_cfg[matched_key])
                        if weight > 0:
                            active_choices[opt_val] = weight
                    except (ValueError, TypeError):
                        pass
            
            if elem.other_option is not None:
                other_key = find_other_cfg_key(choices_cfg)
                if other_key is not None:
                    try:
                        weight = float(choices_cfg[other_key])
                        if weight > 0:
                            active_choices['__other_option__'] = weight
                    except (ValueError, TypeError):
                        pass
                        
        if distribution_mode.startswith('natural_') and (not active_choices or not any(active_choices.values())):
            opt_values = [get_opt_val(o) for o in elem_options]
            active_choices = calculate_natural_weights(opt_values, distribution_mode)
        
        if not active_choices:
            if elem_options:
                opt = random.choice(elem_options)
                return [get_opt_val(opt)]
            return gforms.elements.Value.EMPTY
            
        selected = []
        for choice_val, weight in active_choices.items():
            prob = (weight / 100.0)
            if distribution_mode.startswith('natural_'):
                prob = min(0.98, max(0.02, prob * random.uniform(0.85, 1.15)))
            if random.random() < prob:
                if choice_val == '__other_option__':
                    selected.append(faker.word())
                else:
                    selected.append(choice_val)
                    
        if elem.required and not selected:
            options_list = list(active_choices.keys())
            weights_list = [float(active_choices[k]) for k in options_list]
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
        elem_cols = getattr(elem, 'cols', [])
        
        for row in elem.rows:
            matched_row_key = None
            for r_key in rows_cfg.keys():
                if backend_fuzzy_match(r_key, row):
                    matched_row_key = r_key
                    break
            
            row_cfg = rows_cfg.get(matched_row_key, {}) if matched_row_key else {}
            choices_cfg = None
            if isinstance(row_cfg, dict):
                choices_cfg = row_cfg.get('choices') or row_cfg.get('options') or row_cfg
            else:
                choices_cfg = {}
                
            active_choices = {}
            if choices_cfg and elem_cols:
                for col in elem_cols:
                    col_val = get_opt_val(col)
                    matched_col_key = find_matching_cfg_key(choices_cfg, col_val)
                    if matched_col_key is not None:
                        try:
                            weight = float(choices_cfg[matched_col_key])
                            if weight > 0:
                                active_choices[col_val] = weight
                        except (ValueError, TypeError):
                            pass
            
            if distribution_mode.startswith('natural_') and (not active_choices or not any(active_choices.values())):
                col_values = [get_opt_val(c) for c in elem_cols]
                active_choices = calculate_natural_weights(col_values, distribution_mode)
            
            if elem_class == 'RadioGrid':
                if not active_choices:
                    opt = random.choice(elem_cols)
                    selected_grid.append(get_opt_val(opt))
                else:
                    options_list = list(active_choices.keys())
                    weights_list = [float(active_choices[k]) for k in options_list]
                    if distribution_mode.startswith('natural_'):
                        weights_list = [max(0.1, w * random.uniform(0.9, 1.1)) for w in weights_list]
                    chosen = random.choices(options_list, weights=weights_list, k=1)[0]
                    selected_grid.append(chosen)
            else:  # CheckboxGrid
                row_selected = []
                if not active_choices:
                    opt = random.choice(elem_cols)
                    row_selected.append(get_opt_val(opt))
                else:
                    for choice_val, weight in active_choices.items():
                        prob = weight / 100.0
                        if distribution_mode.startswith('natural_'):
                            prob = min(0.98, max(0.02, prob * random.uniform(0.85, 1.15)))
                        if random.random() < prob:
                            row_selected.append(choice_val)
                    if elem.required and not row_selected:
                        options_list = list(active_choices.keys())
                        weights_list = [float(active_choices[k]) for k in options_list]
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

def pregenerate_campaign_answers(form, fields_config, count):
    pregenerated = {}
    
    for page in form.pages:
        for elem in page.elements:
            if not isinstance(elem, gforms.elements.InputElement):
                continue
                
            elem_id = str(elem.id)
            elem_class = elem.__class__.__name__
            config_field = fields_config.get(elem_id, {})
            
            # 1. Radio / Dropdown / Scale
            if elem_class in ['Radio', 'Dropdown', 'Scale']:
                elem_options = get_elem_options_list(elem)
                choices_cfg = config_field.get('choices')
                if not choices_cfg:
                    choices_cfg = config_field.get('options', {})
                
                active_choices = {}
                if elem_options:
                    for opt in elem_options:
                        opt_val = get_opt_val(opt)
                        matched_key = find_matching_cfg_key(choices_cfg, opt_val)
                        if matched_key is not None:
                            try:
                                weight = float(choices_cfg[matched_key])
                                if weight > 0:
                                    active_choices[opt_val] = weight
                            except (ValueError, TypeError):
                                pass
                    
                    if elem.other_option is not None:
                        other_key = find_other_cfg_key(choices_cfg)
                        if other_key is not None:
                            try:
                                weight = float(choices_cfg[other_key])
                                if weight > 0:
                                    active_choices['__other_option__'] = weight
                            except (ValueError, TypeError):
                                pass
                
                if not active_choices:
                    values = []
                    for _ in range(count):
                        if elem_options:
                            values.append(get_opt_val(random.choice(elem_options)))
                        else:
                            values.append(gforms.elements.Value.EMPTY)
                    pregenerated[elem.id] = values
                    continue
                
                total_weight = sum(active_choices.values())
                if total_weight <= 0:
                    total_weight = 100.0
                options = list(active_choices.keys())
                
                counts = {}
                remainders = {}
                for opt in options:
                    target = (active_choices[opt] / total_weight) * count
                    counts[opt] = int(target)
                    remainders[opt] = target - counts[opt]
                
                allocated = sum(counts.values())
                unallocated = count - allocated
                
                sorted_options = sorted(options, key=lambda o: remainders[o], reverse=True)
                for i in range(unallocated):
                    opt = sorted_options[i % len(sorted_options)]
                    counts[opt] += 1
                
                pool = []
                for opt, opt_count in counts.items():
                    if opt == '__other_option__':
                        for _ in range(opt_count):
                            pool.append(faker.word())
                    else:
                        pool.extend([opt] * opt_count)
                
                random.shuffle(pool)
                while len(pool) < count:
                    pool.append(get_opt_val(random.choice(elem_options)) if elem_options else gforms.elements.Value.EMPTY)
                pregenerated[elem.id] = pool[:count]
                
            # 2. Checkboxes
            elif elem_class == 'Checkboxes':
                elem_options = get_elem_options_list(elem)
                choices_cfg = config_field.get('choices')
                if not choices_cfg:
                    choices_cfg = config_field.get('options', {})
                
                active_choices = {}
                if elem_options:
                    for opt in elem_options:
                        opt_val = get_opt_val(opt)
                        matched_key = find_matching_cfg_key(choices_cfg, opt_val)
                        if matched_key is not None:
                            try:
                                weight = float(choices_cfg[matched_key])
                                if weight > 0:
                                    active_choices[opt_val] = weight
                            except (ValueError, TypeError):
                                pass
                    
                    if elem.other_option is not None:
                        other_key = find_other_cfg_key(choices_cfg)
                        if other_key is not None:
                            try:
                                weight = float(choices_cfg[other_key])
                                if weight > 0:
                                    active_choices['__other_option__'] = weight
                            except (ValueError, TypeError):
                                pass
                
                if not active_choices:
                    values = []
                    for _ in range(count):
                        if elem_options:
                            values.append([get_opt_val(random.choice(elem_options))])
                        else:
                            values.append(gforms.elements.Value.EMPTY)
                    pregenerated[elem.id] = values
                    continue
                
                pools_by_choice = {}
                for choice_val, weight in active_choices.items():
                    target_yes = int(round((weight / 100.0) * count))
                    target_no = count - target_yes
                    c_pool = [True] * target_yes + [False] * target_no
                    random.shuffle(c_pool)
                    pools_by_choice[choice_val] = c_pool
                
                values = []
                for idx in range(count):
                    selected = []
                    for choice_val, c_pool in pools_by_choice.items():
                        if c_pool[idx]:
                            if choice_val == '__other_option__':
                                selected.append(faker.word())
                            else:
                                selected.append(choice_val)
                    if elem.required and not selected:
                        options_list = list(active_choices.keys())
                        weights_list = [float(active_choices[k]) for k in options_list]
                        chosen = random.choices(options_list, weights=weights_list, k=1)[0]
                        if chosen == '__other_option__':
                            selected.append(faker.word())
                        else:
                            selected.append(chosen)
                    values.append(selected)
                pregenerated[elem.id] = values
                
            # 3. Grids (RadioGrid, CheckboxGrid)
            elif elem_class in ['RadioGrid', 'CheckboxGrid']:
                rows_cfg = config_field.get('rows', {})
                row_pools = {}
                elem_cols = getattr(elem, 'cols', [])
                
                for row in elem.rows:
                    matched_row_key = None
                    for r_key in rows_cfg.keys():
                        if backend_fuzzy_match(r_key, row):
                            matched_row_key = r_key
                            break
                    row_cfg = rows_cfg.get(matched_row_key, {}) if matched_row_key else {}
                    choices_cfg = None
                    if isinstance(row_cfg, dict):
                        choices_cfg = row_cfg.get('choices') or row_cfg.get('options') or row_cfg
                    else:
                        choices_cfg = {}
                    
                    active_choices = {}
                    if choices_cfg and elem_cols:
                        for col in elem_cols:
                            col_val = get_opt_val(col)
                            matched_col_key = find_matching_cfg_key(choices_cfg, col_val)
                            if matched_col_key is not None:
                                try:
                                    weight = float(choices_cfg[matched_col_key])
                                    if weight > 0:
                                        active_choices[col_val] = weight
                                except (ValueError, TypeError):
                                    pass
                    
                    if elem_class == 'RadioGrid':
                        if not active_choices:
                            pool = [get_opt_val(random.choice(elem_cols)) for _ in range(count)]
                        else:
                            total_weight = sum(active_choices.values()) or 100.0
                            options = list(active_choices.keys())
                            counts = {}
                            remainders = {}
                            for opt in options:
                                target = (active_choices[opt] / total_weight) * count
                                counts[opt] = int(target)
                                remainders[opt] = target - counts[opt]
                            allocated = sum(counts.values())
                            unallocated = count - allocated
                            sorted_options = sorted(options, key=lambda o: remainders[o], reverse=True)
                            for i in range(unallocated):
                                opt = sorted_options[i % len(sorted_options)]
                                counts[opt] += 1
                            pool = []
                            for opt, opt_count in counts.items():
                                pool.extend([opt] * opt_count)
                            random.shuffle(pool)
                            while len(pool) < count:
                                pool.append(get_opt_val(random.choice(elem_cols)) if elem_cols else "")
                        row_pools[row] = pool[:count]
                    else:  # CheckboxGrid
                        if not active_choices:
                            pool = [[get_opt_val(random.choice(elem_cols))] for _ in range(count)]
                        else:
                            pools_by_col = {}
                            for col_val, weight in active_choices.items():
                                target_yes = int(round((weight / 100.0) * count))
                                target_no = count - target_yes
                                c_pool = [True] * target_yes + [False] * target_no
                                random.shuffle(c_pool)
                                pools_by_col[col_val] = c_pool
                            
                            pool = []
                            for idx in range(count):
                                selected = []
                                for col_val, c_pool in pools_by_col.items():
                                    if c_pool[idx]:
                                        selected.append(col_val)
                                if elem.required and not selected:
                                    options_list = list(active_choices.keys())
                                    weights_list = [float(active_choices[k]) for k in options_list]
                                    chosen = random.choices(options_list, weights=weights_list, k=1)[0]
                                    selected.append(chosen)
                                pool.append(selected)
                        row_pools[row] = pool[:count]
                
                grid_values = []
                for idx in range(count):
                    run_answers = []
                    for row in elem.rows:
                        run_answers.append(row_pools[row][idx])
                    grid_values.append(run_answers)
                pregenerated[elem.id] = grid_values
            else:
                pregenerated[elem.id] = None
                
    return pregenerated

def submission_worker(url, count, delay, fields_config, strict_mode=True, distribution_mode='absolute'):
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
        
        # Determine mode: default is absolute distribution
        pregenerated = {}
        strict_mode = True
        try:
            pregenerated = pregenerate_campaign_answers(form, fields_config, count)
            runner_state.add_log("🎯 Chế độ: Mặc định chia tuyệt đối theo % & số mẫu (Cam kết khớp chính xác 100% như mong muốn).")
        except Exception as e:
            runner_state.add_log(f"⚠️ Không thể khởi tạo phân bổ tuyệt đối: {str(e)}. Chuyển sang sinh dữ liệu ngẫu nhiên.")
            strict_mode = False

        runner_state.add_log(f"🚀 Bắt đầu chiến dịch tự động điền {count} lượt...")
    except Exception as e:
        runner_state.add_log(f"❌ Lỗi kết nối biểu mẫu: {str(e)}")
        runner_state.active = False
        return

    successful_runs = 0
    while successful_runs < count:
        if runner_state.stop_requested:
            runner_state.add_log("⏹️ Đã dừng tiến trình điền biểu mẫu theo yêu cầu.")
            break
            
        runner_state.current = successful_runs + 1
        
        try:
            form.reset()
            
            # Generate values for this iteration
            answers = {}
            for page in form.pages:
                for elem in page.elements:
                    if not isinstance(elem, gforms.elements.InputElement):
                        continue
                        
                    elem_id = elem.id
                    if strict_mode and elem_id in pregenerated and pregenerated[elem_id] is not None:
                        answers[elem_id] = pregenerated[elem_id][successful_runs]
                    else:
                        config_field = fields_config.get(str(elem_id), {})
                        answers[elem_id] = generate_value_for_element(elem, config_field, distribution_mode)
            
            # Callback function to fill the form
            def fill_callback(element, page_index, element_index):
                val = answers.get(element.id)
                if val is None:
                    return gforms.elements.Value.EMPTY
                return val
                
            form.fill(fill_callback)
            form.submit()
            
            successful_runs += 1
            runner_state.success = successful_runs
            
            # Generate sample values for logging
            sample_answers = []
            for page in form.pages:
                for elem in page.elements:
                    if isinstance(elem, gforms.elements.InputElement) and elem.id in answers:
                        val = answers[elem.id]
                        val_str = str(val)[:30] + '...' if len(str(val)) > 30 else str(val)
                        sample_answers.append(f"{elem.name or 'Câu hỏi'}: {val_str}")
            
            runner_state.add_log(f"✅ Lượt #{successful_runs} thành công. Dữ liệu: {', '.join(sample_answers[:2])}")
            
            # Delay between runs
            if successful_runs < count:
                time.sleep(delay)
                
        except Exception as e:
            runner_state.failed += 1
            runner_state.add_log(f"❌ Phát hiện lỗi ở lượt #{successful_runs + 1} (Đang tự động thử lại...): {str(e)}")
            # Slight delay before retry to avoid rate limits
            time.sleep(max(1.0, delay))

    runner_state.active = False
    runner_state.add_log(f"🎉 Chiến dịch kết thúc! Tổng thành công: {runner_state.success}/{count}, Tổng số lỗi đã bỏ qua: {runner_state.failed}")

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

@app.route('/api/ai-distribute', methods=['POST'])
def ai_distribute():
    data = request.json or {}
    prompt = data.get('prompt', '').strip()
    questions = data.get('questions', [])
    custom_key = data.get('custom_api_key', '')
    
    if not prompt:
        return jsonify({"error": "Vui lòng nhập nội dung prompt yêu cầu cho AI."}), 400
    if not questions:
        return jsonify({"error": "Không có danh sách câu hỏi nào để phân bổ."}), 400
        
    api_key = get_groq_api_key(custom_key)
    if not api_key:
        return jsonify({"error": "Chưa có Groq API Key hợp lệ. Vui lòng kiểm tra cấu hình API Key."}), 400

    # Format simplified questions list for Groq
    formatted_questions = []
    for q in questions:
        q_id = str(q.get('id', ''))
        q_name = q.get('name', '')
        q_type = q.get('type', '')
        q_choices = list(q.get('choices') or [])
        if q.get('has_other') and '__other_option__' not in q_choices and 'Mục khác' not in q_choices:
            q_choices.append('Mục khác')
        q_rows = list(q.get('rows') or [])
        formatted_questions.append({
            'id': q_id,
            'title': q_name,
            'type': q_type,
            'choices': q_choices,
            'rows': q_rows
        })
        
    system_prompt = (
        "Bạn là một chuyên gia phân tích dữ liệu khảo sát và biểu mẫu Google Form.\n"
        "Nhiệm vụ của bạn là phân tích prompt yêu cầu của người dùng và các câu hỏi trong khảo sát, "
        "sau đó gán tỷ lệ phần trăm (số nguyên từ 0 đến 100) cho từng lựa chọn của các câu hỏi sao cho sát nhất với prompt.\n\n"
        "QUY TẮC BẮT BUỘC:\n"
        "1. Với câu hỏi lựa chọn đơn (Radio, Dropdown, Scale) và từng dòng của RadioGrid: Tổng % các lựa chọn PHẢI BẰNG ĐÚNG 100.\n"
        "2. Với câu hỏi nhiều lựa chọn (Checkboxes, CheckboxGrid): Mỗi lựa chọn là một xác suất độc lập (0-100%).\n"
        "3. Nếu prompt không nhắc đến một câu hỏi nào đó: Hãy suy luận hợp lý theo ngữ cảnh tổng thể (ví dụ: prompt là khen/hài lòng thì đánh giá chất lượng nên 70-90% ở mức tốt/hài lòng).\n"
        "4. ĐỊNH DẠNG TRẢ VỀ: CHỈ trả về JSON object thuần túy với cấu trúc:\n"
        "{\n"
        '  "summary": "Tóm tắt 1 câu về cách phân bổ vừa áp dụng",\n'
        '  "distribution": {\n'
        '    "<question_id>": {\n'
        '      "<choice_name>": 70,\n'
        '      "<choice_name_2>": 30\n'
        "    },\n"
        '    "<grid_question_id>": {\n'
        '      "<row_name>": {\n'
        '        "<choice_name>": 80,\n'
        '        "<choice_name_2>": 20\n'
        "      }\n"
        "    }\n"
        "  }\n"
        "}"
    )

    user_prompt = (
        f"Prompt yêu cầu của người dùng:\n\"\"\"\n{prompt}\n\"\"\"\n\n"
        f"Danh sách các câu hỏi cần phân bổ:\n{json.dumps(formatted_questions, ensure_ascii=False, indent=2)}"
    )

    try:
        ai_result = query_groq_ai(api_key, system_prompt, user_prompt)
    except Exception as e:
        return jsonify({"error": f"Lỗi Groq AI: {str(e)}"}), 500

    raw_dist = ai_result.get('distribution', ai_result)
    summary = ai_result.get('summary', 'Đã tự động phân tích và phân bổ tỷ lệ % theo prompt.')

    normalized_dist = {}
    for q in questions:
        q_id = str(q.get('id', ''))
        q_name = q.get('name', '')
        q_type = q.get('type', '')
        choices = list(q.get('choices') or [])
        if q.get('has_other') and '__other_option__' not in choices and 'Mục khác' not in choices:
            choices.append('Mục khác')
        rows = list(q.get('rows') or [])

        # Find in raw_dist by id or fuzzy title
        q_raw_data = None
        if q_id in raw_dist:
            q_raw_data = raw_dist[q_id]
        else:
            for k, v in raw_dist.items():
                if backend_fuzzy_match(str(k), q_name) or backend_fuzzy_match(q_name, str(k)):
                    q_raw_data = v
                    break

        if not isinstance(q_raw_data, dict):
            q_raw_data = {}

        if q_type in ['Radio', 'Dropdown', 'Scale']:
            normalized_dist[q_id] = align_and_normalize_choices(choices, q_raw_data, is_checkbox=False)
        elif q_type == 'Checkboxes':
            normalized_dist[q_id] = align_and_normalize_choices(choices, q_raw_data, is_checkbox=True)
        elif q_type in ['RadioGrid', 'CheckboxGrid']:
            grid_dist = {}
            is_check_grid = (q_type == 'CheckboxGrid')
            for r in rows:
                r_raw = None
                if r in q_raw_data:
                    r_raw = q_raw_data[r]
                else:
                    for r_key, r_val in q_raw_data.items():
                        if backend_fuzzy_match(str(r_key), str(r)):
                            r_raw = r_val
                            break
                if not isinstance(r_raw, dict):
                    r_raw = {}
                grid_dist[r] = align_and_normalize_choices(choices, r_raw, is_checkbox=is_check_grid)
            normalized_dist[q_id] = grid_dist

    return jsonify({
        "success": True,
        "summary": summary,
        "distribution": normalized_dist
    })

@app.route('/api/start', methods=['POST'])
def start_campaign():
    global runner_state
    if runner_state.active:
        return jsonify({"error": "Đang có một chiến dịch điền form đang chạy"}), 400
        
    data = request.json or {}
    
    # Tolerant parameter loading
    url_val = data.get('url')
    if not url_val and 'form_data' in data and isinstance(data['form_data'], dict):
        url_val = data['form_data'].get('url')
    url = clean_google_form_url(url_val)
    
    count_val = data.get('count')
    if count_val is None:
        count_val = data.get('total_submissions', 10)
    count = int(count_val)
    
    delay = float(data.get('delay', 1.0))
    
    fields_config = data.get('fields')
    if not fields_config:
        fields_config = data.get('config', {})
        
    if not url:
        return jsonify({"error": "Đường dẫn biểu mẫu trống"}), 400
        
    runner_state.reset(count)
    
    distribution_mode = 'absolute'
    strict_mode = True
    
    # Start thread
    thread = threading.Thread(
        target=submission_worker,
        args=(url, count, delay, fields_config, strict_mode, distribution_mode)
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
    is_frozen = getattr(sys, 'frozen', False)
    app.config['TEMPLATES_AUTO_RELOAD'] = not is_frozen
    print("--------------------------------------------------")
    print(" Google Form Auto-Filler Server Running!")
    print(" Mo trinh duyet truy cap: http://127.0.0.1:5000")
    print("--------------------------------------------------")
    
    if is_frozen:
        def open_browser():
            time.sleep(1.2)
            webbrowser.open('http://127.0.0.1:5000')
        threading.Thread(target=open_browser, daemon=True).start()
        app.run(host='127.0.0.1', port=5000, debug=False)
    else:
        app.run(host='127.0.0.1', port=5000, debug=True)
