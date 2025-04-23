import * as model from './db.js'
import express from 'express'
import cors from "cors";
import axios from "axios";
import tokenService from "./services/tokenService.js";
import cookieParser from "cookie-parser";
import * as uuid from "uuid";
import mailService from "./services/mail-service.js";
import {changeUserPassword} from "./db.js";

const app = express()
app.use(express.json())
app.use(cookieParser());
app.use(cors({
    origin: "http://localhost:9000", // или true для любого origin
  credentials: true, // разрешаем куки и авторизационные заголовки
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.get('/health', (req, res) => res.status(200).send('OK'));


function auth(req) {

    const authorizationHeader = req.headers.authorization;
    if (!authorizationHeader) {
        return false;
    }

    const accessToken = authorizationHeader.split(' ')[1];
    if (!accessToken) {
        return false;
    }

    const userData = tokenService.validateAccessToken(accessToken);
    if (!userData) {
        return false;
    }

    return userData;
}

function not_auth(res) {
    return "dadad"
}

async function doAuth(res, user) {
    const tokens = tokenService.generateTokens({user_id: user.user_id});
    await model.saveRefreshToken(user.user_id, tokens.refreshToken)

    res.cookie('refreshToken', tokens.refreshToken, {maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true})

    res.status(200).json({
        success: true,
        data: {
            user_id: user.user_id,
            refreshToken: tokens.refreshToken,
            accessToken: tokens.accessToken
        }
    });
}

app.post('/api/createUser', async (req, res) => {
    let user = auth(req);
    if (user) {
        return res.status(400).json({
            success: false,
            error: 'User_authorized'
        });
    }


    let createdUserId = -1;

    try {
        const {email, password, nickname} = req.body;
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'email, nickname and password are required'
            });
        }

        if (password.length > 40) {
            return res.status(400).json({
                success: false,
                error: 'Пароль д.б не пустой и не длиннее 40 символов!',
                error_field: "password"
            });
        }

        if (!email || email.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Email не может быть пустым',
                error_field: "email"
            });
        }

        if (!nickname || nickname > 25) {
            return res.status(400).json({
                success: false,
                error: 'Название профиля должно быть не пустым и не длиннее 25 символов!',
                error_field: "nickname"
            });
        }

        let userWithEmail = await model.getUserByEmail(email);
        if (userWithEmail) {
            return res.status(400).json({
                success: false,
                error: 'Пользователь с таким email уже зарегистрирован в системе!',
                error_field: "email"
            });
        }

        let activationLink = uuid.v4();
        let user = await model.createUser(email, password, activationLink);
        if (!user) {
            return res.status(400).json({
                success: false,
                error: 'Unknown_error'
            });
        }

        createdUserId = user.user_id;

        //TODO set brocker!!!
        let createProfileRequest = await axios.post("http://localhost:8001/api/createProfile", {
            user_id: user.user_id,
            nickname: nickname
        });

        if (createProfileRequest.status === 200 && createProfileRequest.data.success) {

            await mailService.sendActivationMail(email, "http://localhost:9000/activation/" + activationLink)
            res.status(200).json({
                success: true,
                data: {}
            });
        } else {
            await model.deleteUser(user.user_id);
            res.status(500).json({
                success: false,
                error: "Unknown_error"
            });
        }


    } catch (error) {
        if (createdUserId !== -1) await model.deleteUser(createdUserId);
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
    let user = auth(req);
    if (user) {
        return res.status(400).json({
            success: false,
            error: 'User_authorized'
        });
    }

    try {
        const {email, password} = req.body;
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'email and password are required'
            });
        }

        let user = await model.authUser(email, password);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        await doAuth(res, user);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/refreshToken', async (req, res) => {
    try {
        const {refreshToken} = req.cookies;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                error: 'wrong token'
            });
        }

        let userData = tokenService.validateRefreshToken(refreshToken)
        if (!userData) {
            return res.status(400).json({
                success: false,
                error: 'wrong token'
            });
        }

        const foundToken = await model.findRefreshToken(refreshToken);
        if (!foundToken) {
            return res.status(400).json({
                success: false,
                error: 'User_not_found'
            });
        }

        const user = await model.getUserById(userData.user_id);
        if (!user) {
            return res.status(400).json({
                success: false,
                error: 'User_not_found'
            });
        }

        const tokens = tokenService.generateTokens({user_id: user.user_id})
        let saveTokenRes = await model.saveRefreshToken(user.user_id, tokens.refreshToken);
        if (!saveTokenRes) {
            return res.status(400).json({
                success: false,
                error: 'Save token failed'
            });
        }

        res.cookie('refreshToken', refreshToken, {maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true})


        res.status(200).json({
            success: true,
            data: {
                user_id: user.id,
                ...tokens
            }
        });

    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
})

app.post('/api/logout', async (req, res) => {
    let user = auth(req);
    if (!user) return not_auth(res);

    try {
        const {refreshToken} = req.cookies;
        let delRes = await model.removeRefreshToken(refreshToken);
        if (!delRes) {
            return res.status(400).json({
                success: false,
                error: 'Logout failed'
            });
        }
        res.clearCookie('refreshToken');
        res.status(200).json({
            success: true,
            data: {}
        });

    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.post('/api/forgotPassword', async (req, res) => {
    let user = auth(req);
    if (user) {
        return res.status(400).json({
            success: false,
            error: 'User_authorized'
        });
    }


    try {
        const {email} = req.body;

        let user = await model.getUserByEmail(email);
        if (!user || !user.is_activated) {
            return res.status(400).json({
                success: false,
                error: 'User_not_found'
            });
        }

        const forgotPasswordLink = uuid.v4();
        let setChangeLinkRes = await model.setForgotPasswordToken(user.user_id, forgotPasswordLink);

        if (!setChangeLinkRes) {
            return res.status(400).json({
                success: false,
                error: 'Unknown_error'
            });
        }

        await mailService.sendChangePasswordMail(email, "http://localhost:9000/changePassword/" + forgotPasswordLink);
        res.status(200).json({
            success: true,
            data: {}
        });


    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.post('/api/changePassword', async (req, res) => {
    try {
        const {password_change_token, password} = req.body;

        if (!password_change_token) {
            return res.status(400).json({
                success: false,
                error: 'User_not_found'
            });
        }

        if (!password || password.length > 40) {
            return res.status(400).json({
                success: false,
                error: 'Пароль д.б не пустой и не длиннее 40 символов!',
                error_field: "password"
            });
        }

        let user = await model.findUserByPasswordForgotToken(password_change_token);
        if (!user || !user.is_activated) {
            return res.status(400).json({
                success: false,
                error: 'User_not_found'
            });
        }

        let changePasswordRes = await model.changeUserPassword(password, password_change_token);
        if (!changePasswordRes) {
            return res.status(400).json({
                success: false,
                error: 'Unknown_error'
            });
        }

        await doAuth(res, user);

    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.get('/api/activateAccount', async (req, res) => {
    try {
        const {activation_link} = req.query;

        if (!activation_link) {
            return res.status(400).json({
                success: false,
                error: 'User_not_found'
            });
        }

        let user = await model.findUserByActivationLink(activation_link);
        if (!user) {
            return res.status(400).json({
                success: false,
                error: 'User_not_found'
            });
        }

        let activationResult = await model.activateUser(user.user_id);
        if (!activationResult) {
            return res.status(400).json({
                success: false,
                error: 'Unknown_error'
            });
        }

        await doAuth(res, user);

    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

app.listen(8002, () => {

})