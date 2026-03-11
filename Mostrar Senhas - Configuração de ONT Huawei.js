// ==UserScript==
// @name         Mostrar Senhas - Configuração de ONT Huawei
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Altera os campos de senha para texto visível na página de configuração de ONT Huawei
// @author       inaciodinucci
// @match        https://www.clickenter.com.br/projects/EasyConfigHuaweiWeb/
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    function mostrarSenhas() {
        const wifiSenha = document.querySelector('input[name="wifi_senha"]');
        if (wifiSenha) {
            wifiSenha.type = 'text';
        }
        const pppoeSenha = document.querySelector('input[name="pppoe_senha"]');
        if (pppoeSenha) {
            pppoeSenha.type = 'text';
        }
    }
    window.addEventListener('load', mostrarSenhas);
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(mostrarSenhas, 100);
    } else {
        document.addEventListener('DOMContentLoaded', mostrarSenhas);
    }
})();