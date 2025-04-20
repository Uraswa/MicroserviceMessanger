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

app.get('/api/getUserProfilesByIds', async (req, res) => {
    let ids = req.query.ids;
    if (!ids) {
        res.status(500).json({
            success: false,
            error: "Ids empty"
        });
        return;
    }

    ids = JSON.parse(ids);
    let profiles = await model.getUserProfilesByIds(ids, ids.length);
    res.status(200).json({
        success: true,
        data: {profiles}
    });

})

app.get('/api/getProfiles', async (req, res) => {
    const user = auth(req);
    if (!user) return not_auth(res);

    try {

        let profileName = req.query.profileName;

        if (!profileName || profileName.length > 40) {
            return res.status(400).json({
                success: false,
                error: "wrong idenfier"
            });
        }

        let profiles = await model.getUserProfiles(profileName);
        return res.status(200).json({
                    success: true,
                    data: profiles
                });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
})

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
        const {nickname, description, birth_date} = req.body;
        const result = await model.updateUserProfile(user.user_id, {nickname, description, birthDate: birth_date});

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

app.listen(8001, () => {

})
