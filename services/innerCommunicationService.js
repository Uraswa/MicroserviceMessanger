import tokenService from "./tokenService.js";
import axios from "axios";

class InnerCommunicationService {

    serverAccessToken;
    api;

    init() {
        this.api = axios.create({
            withCredentials: true,
            baseURL: "http://212.33.245.152"
        });

        let $api = this.api;
        let communicationService = this;

        this.api.interceptors.request.use((config) => {
            config.headers.Authorization = `Bearer ${communicationService.serverAccessToken}`;

            return config;
        });

        this.api.interceptors.response.use((config) => {
            return config;
        }, async (error) => {
            const originalRequest = error.config;
            if (error.response && error.response.status === 401 && error.config && !error.config._isRetry) {
                originalRequest._isRetry = true;
                communicationService._validateCredentials();
                try {
                    return $api.request(originalRequest);
                } catch (e) {
                    console.log('НЕ АВТОРИЗОВАН' + e)
                }
            }
            throw error;
        })
    }

    _validateCredentials() {
        if (!this.serverAccessToken || !tokenService.validateAccessToken(this.serverAccessToken)) {
            let {accessToken, refreshToken} = tokenService.generateTokens({
                is_server: true
            }, '5m', '5m');
            this.serverAccessToken = accessToken;
        }

    }

    async post(endPoint, data) {
        this._validateCredentials();

        return await this.api.post(endPoint, data);
    }

    async get(endPoint) {
        this._validateCredentials();
        return await this.api.get(endPoint);
    }

}

let serviceInstance = new InnerCommunicationService();
serviceInstance.init();
export default serviceInstance;