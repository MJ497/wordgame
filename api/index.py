import os
from flask import Flask, request, jsonify, render_template, session, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

# ─── Init Flask ────────────────────────────────────────────
app = Flask(__name__, template_folder="../templates", static_folder="../static")

# ─── Environment & Config ─────────────────────────────────
# Ensure DATABASE_URL is set
DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    raise RuntimeError("Missing DATABASE_URL environment variable")
app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Secret key for session & flash; fallback only for development
app.secret_key = os.getenv("SECRET_KEY", "dev-fallback-key")

# Optional session hardening
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
)

# ─── Initialize extensions ─────────────────────────────────
db = SQLAlchemy(app)
migrate = Migrate(app, db)

# ─── Models ────────────────────────────────────────────────
class User(db.Model):
    id            = db.Column(db.Integer, primary_key=True)
    fullname      = db.Column(db.String(120), nullable=False)
    email         = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)

    def set_password(self, pw):
        self.password_hash = generate_password_hash(pw)

    def check_password(self, pw):
        return check_password_hash(self.password_hash, pw)

class LeaderboardEntry(db.Model):
    id          = db.Column(db.Integer, primary_key=True)
    player_name = db.Column(db.String(100), nullable=False)
    score       = db.Column(db.Integer, nullable=False)
    level       = db.Column(db.String(20), nullable=False)
    timestamp   = db.Column(db.DateTime, default=datetime.utcnow)

class Word(db.Model):
    id    = db.Column(db.Integer, primary_key=True)
    text  = db.Column(db.String(50), unique=True, nullable=False)
    level = db.Column(db.String(20), nullable=False)

# ─── Page Routes ──────────────────────────────────────────
@app.route('/')
def home():
    return render_template('index.html')

# ─── User Auth Routes ─────────────────────────────────────
@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        name     = request.form.get('name')
        email    = request.form.get('email')
        password = request.form.get('password')

        if not name or not email or not password:
            return 'Missing fields', 400

        if User.query.filter_by(email=email).first():
            return 'Email already registered', 409

        user = User(fullname=name, email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        return render_template('sucessfulsign.html')

    return render_template('signup.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email    = request.form.get('email')
        password = request.form.get('password')
        user     = User.query.filter_by(email=email).first()

        if not user or not user.check_password(password):
            flash('Incorrect email or password.', 'error')
            return redirect(url_for('login'))

        session['user_id'] = user.id
        return render_template('sucessful.html')

    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

@app.route('/dashboard')
def dashboard():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    user = User.query.get(session['user_id'])
    return render_template('dashboard.html', fullname=user.fullname)

# ─── Leaderboard API ───────────────────────────────────────
@app.route('/api/leaderboard', methods=['GET', 'POST'])
def leaderboard():
    if request.method == 'GET':
        limit  = int(request.args.get('limit', 10))
        offset = int(request.args.get('offset', 0))
        entries = (LeaderboardEntry
                   .query
                   .order_by(LeaderboardEntry.score.desc(),
                             LeaderboardEntry.timestamp.asc())
                   .offset(offset)
                   .limit(limit)
                   .all())
        return jsonify([{
            'rank':   i + offset + 1,
            'player': e.player_name,
            'score':  e.score,
            'level':  e.level
        } for i, e in enumerate(entries)])
    # POST
    data = request.get_json()
    entry = LeaderboardEntry(
        player_name=data['player'],
        score=data['score'],
        level=data['level']
    )
    db.session.add(entry)
    db.session.commit()
    return jsonify({'message': 'Score submitted successfully'}), 201

# ─── Words API ─────────────────────────────────────────────
@app.route('/api/words')
def get_words():
    all_words = Word.query.all()
    out = {'easy': [], 'medium': [], 'hard': []}
    for w in all_words:
        out[w.level].append(w.text.upper())
    return jsonify(out)

# ─── Admin Routes ─────────────────────────────────────────
@app.route('/admin')
def admin_panel():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    users = User.query.all()
    words = Word.query.order_by(Word.level, Word.text).all()
    return render_template('admin.html', users=users, words=words)

@app.route('/admin/word/add', methods=['POST'])
def admin_add_word():
    text  = request.form['text'].strip().upper()
    level = request.form['level']
    if text and level in ('easy', 'medium', 'hard'):
        if not Word.query.filter_by(text=text).first():
            db.session.add(Word(text=text, level=level))
            db.session.commit()
            flash(f'Added word {text}', 'success')
        else:
            flash('That word already exists', 'warning')
    return redirect(url_for('admin_panel'))

@app.route('/admin/word/delete/<int:word_id>')
def admin_delete_word(word_id):
    w = Word.query.get_or_404(word_id)
    db.session.delete(w)
    db.session.commit()
    flash(f'Deleted {w.text}', 'info')
    return redirect(url_for('admin_panel'))

@app.route('/admin/user/delete/<int:user_id>')
def admin_delete_user(user_id):
    u = User.query.get_or_404(user_id)
    db.session.delete(u)
    db.session.commit()
    flash(f'Removed user {u.fullname}', 'info')
    return redirect(url_for('admin_panel'))

# ─── Vercel Serverless handler ───────────────────────────
def handler(request, context):
    return app(request.scope, request.receive, request.send)

# ─── Run (development only) ───────────────────────────────
if __name__ == "__main__":
    app.run(debug=True)
