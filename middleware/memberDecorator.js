import ChatsModel from "../Model/ChatsModel.js";

export default (adminRequired, mustBeNotBlocked) => {
    return async (req, res, next) => {

        let chat_id = req.body.chat_id;
        if (!chat_id) {
            chat_id = req.query.chat_id;
        }

        if (!chat_id) {
            return res.status(200).json({
                success: false,
                error: "Чат не найден"
            })
        }

        let member = await ChatsModel.getChatMember(chat_id, req.user.user_id);
        if (!member || !member.is_admin && adminRequired || member.is_kicked || mustBeNotBlocked && member.is_blocked) {

            return res.status(200).json({
                success: false,
                error: "Permission_denied"
            })
        }

        req.member = member;
        next();
    }
}