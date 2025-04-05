const express = require("express");
const model = require("./db");
const app = express();
app.use(express.json())
app.get('/health', (req, res) => res.status(200).send('OK'));

function auth(req) {
    return {user_id: 123}
}

function not_auth(res) {
    return "dadad"
}

// Эндпоинты
app.get('/api/getChats', async (req, res) => {
    const user = auth(req);
    if (!user) return not_auth(res);

    try {
        const filters = req.query.filters || {};
        const chats = await model.getChats(user.user_id, filters);

        res.status(200).json({
            success: true,
            data: chats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/getMessages', async (req, res) => {
    const user = auth(req);
    if (!user) return not_auth(res);

    try {
        const {chat_id, limit = 50, last_message_id = 99999999999999} = req.query;
        if (!chat_id) {
            return res.status(400).json({
                success: false,
                error: 'chat_id is required'
            });
        }

        if (!await model.getChatMember(chat_id, user.user_id)) {
            return res.status(403).json({
                success: false,
                error: 'access denied'
            });
        }

        const messages = await pool.query(
            `SELECT *
             FROM messages
             WHERE chat_id = $1
               and message_id < $3
             ORDER BY timestamp DESC
             LIMIT $2`,
            [chat_id, limit, last_message_id]
        );

        res.status(200).json({
            success: true,
            data: messages.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/getProfile', async (req, res) => {
    const user = auth(req);
    if (!user) return not_auth(res);

    try {
        const {user_id} = req.query;
        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'user_id is required'
            });
        }

        const profile = await model.getUserProfile(user_id);

        res.status(200).json({
            success: true,
            data: profile
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.patch('/api/updateProfile', async (req, res) => {
    const user = auth(req);
    if (!user) return not_auth(res);

    try {
        const {description, birth_date} = req.body;
        const result = await model.updateUserProfile(user.user_id, {description, birthDate: birth_date});

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/createUser', async (req, res) => {
    try {
        const {email, nickname, password} = req.body;
        if (!email || !nickname || !password) {
            return res.status(400).json({
                success: false,
                error: 'email, nickname and password are required'
            });
        }

        const hashedPassword = password;

        const result = await pool.query(
            `INSERT INTO users (email, nickname, password)
             VALUES ($1, $2, $3)
             RETURNING user_id, email, nickname, reg_date`,
            [email, nickname, hashedPassword]
        );

        res.status(201).json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        if (error.code === '23505') { // Ошибка уникальности в PostgreSQL
            return res.status(400).json({
                success: false,
                error: 'Email already exists'
            });
        }
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const {email, password} = req.body;
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'email and password are required'
            });
        }

        const user = await pool.query(
            `SELECT user_id, email, nickname, password
             FROM users
             WHERE email = $1`,
            [email]
        );

        if (!user.rows.length) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        const isValidPassword = (password === user.rows[0].password);

        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        // Генерация JWT токена (заглушка)
        //const token = generateToken(user.rows[0].user_id);
        const token = 'abracadarba'; //TODO

        res.status(200).json({
            success: true,
            data: {
                token,
                user: {
                    user_id: user.rows[0].user_id,
                    email: user.rows[0].email,
                    nickname: user.rows[0].nickname
                }
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close();
});