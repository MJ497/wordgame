import os
from flask import Flask, request, jsonify, render_template, session, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import secrets

# ─── Init Flask ────────────────────────────────────────────
app = Flask(__name__, template_folder="../Templates", static_folder="../static")

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
    print("Logging out, session before:", dict(session))
    session.clear()
    print("Session after:", dict(session))
    return redirect(url_for('home'))

@app.route('/dashboard')
def dashboard():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    user = User.query.get(session['user_id'])
    return render_template('dashboard.html', fullname=user.fullname)

# ─── Leaderboard API ───────────────────────────────────────
@app.route('/api/leaderboard', methods=['POST'])
def post_leaderboard():
    data = request.get_json()
    player = data.get('player')
    score = data.get('score')
    level = data.get('level')
    if not player or not score or not level:
        return jsonify({'error': 'Missing data'}), 400
    entry = LeaderboardEntry(player_name=player, score=score, level=level)
    db.session.add(entry)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/leaderboard', methods=['GET'])
def get_leaderboard():
    mode = request.args.get('mode', 'normal')
    if mode == 'aggregate':
        # Aggregate: sum scores per player, rank by total score
        results = (
            db.session.query(
                LeaderboardEntry.player_name,
                db.func.sum(LeaderboardEntry.score).label('score')
            )
            .group_by(LeaderboardEntry.player_name)
            .order_by(db.desc('score'))
            .all()
        )
        return jsonify([
            {
                'rank': i + 1,
                'player': row.player_name,
                'score': int(row.score)
            }
            for i, row in enumerate(results)
        ])
    else:
        # Normal: show each game entry
        entries = (
            LeaderboardEntry
            .query
            .order_by(LeaderboardEntry.score.desc(),
                      LeaderboardEntry.timestamp.asc())
            .all()
        )
        return jsonify([
            {
                'rank': i + 1,
                'player': e.player_name,
                'score': e.score,
                'level': e.level
            }
            for i, e in enumerate(entries)
        ])

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

@app.route('/admin/clear_leaderboard')
def clear_leaderboard():
    LeaderboardEntry.query.delete()
    db.session.commit()
    return "Leaderboard cleared!"


reset_tokens = {}  # In-memory store for demo; use a DB or cache for production

@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    show_link = False
    if request.method == 'POST':
        email = request.form.get('email')
        user = User.query.filter_by(email=email).first()
        if user:
            token = secrets.token_urlsafe(32)
            reset_tokens[token] = user.id
            reset_link = url_for('reset_password', token=token, _external=True)
            flash(reset_link, 'info')
            show_link = True
        else:
            flash('If that email is registered, a reset link has been sent.', 'info')
        return render_template('forgot_password.html', show_link=show_link)
    return render_template('forgot_password.html', show_link=show_link)

@app.route('/reset-password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    user_id = reset_tokens.get(token)
    if not user_id:
        flash('Invalid or expired reset link.', 'error')
        return redirect(url_for('forgot_password'))
    user = User.query.get(user_id)
    if not user:
        flash('User not found.', 'error')
        return redirect(url_for('forgot_password'))
    if request.method == 'POST':
        password = request.form.get('password')
        if not password:
            flash('Password required.', 'error')
            return render_template('reset_password.html')
        user.set_password(password)
        db.session.commit()
        reset_tokens.pop(token, None)
        flash('Password reset successful. You can now log in.', 'success')
        return redirect(url_for('login'))
    return render_template('reset_password.html')




