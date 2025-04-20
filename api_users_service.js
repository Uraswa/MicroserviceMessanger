import * as model from './db.js'
import express from 'express'
import cors from "cors";

const app = express()
app.use(express.json())
app.use(cors())
app.get('/health', (req, res) => res.status(200).send('OK'));


function auth(req) {
    return {user_id: req.query.user_id ? req.query.user_id : 1}
}
function not_auth(res) {
    return "dadad"
}

app.post('/api/createUser', async (req, res) => {
    try {
        const {email, password} = req.body;
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'email, nickname and password are required'
            });
        }

        const hashedPassword = password;

        const result = await pool.query(
            `INSERT INTO users (email, password)
             VALUES ($1, $2, $3)
             RETURNING user_id, email, reg_date`,
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