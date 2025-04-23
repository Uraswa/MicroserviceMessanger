import {createTransport} from "nodemailer";

class MailService {

    constructor() {

    }

    configureTransport(){
        this.transporter = createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASSWORD
            }
        })
    }

    async sendActivationMail(to, link) {
        if (!this.transporter) this.configureTransport();
        await this.transporter.sendMail({
            from: process.env.SMTP_USER,
            to,
            subject: 'Активация аккаунта на ' + process.env.API_URL,
            text: '',
            html:
                `
                    <div>
                        <h1>Для активации перейдите по ссылке</h1>
                        <a href="${link}">${link}</a>
                    </div>
                `
        })
    }

    async sendChangePasswordMail(to, link) {
        if (!this.transporter) this.configureTransport();
        await this.transporter.sendMail({
            from: process.env.SMTP_USER,
            to,
            subject: 'Восстановление пароля на ' + process.env.API_URL,
            text: '',
            html:
                `
                    <div>
                        <h1>Для восстановления пароля пройдите по ссылке</h1>
                        <a href="${link}">${link}</a>
                    </div>
                `
        })
    }
}


export default new MailService();