// ==UserScript==
// @name         Login Huawei
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Login automático no acesso remoto da ClickEnter , para utilizar basta apertar a tecla "-" (@isp#click) ou "+" (adminEp) do numpad, que ele irá preencher os login na tela de autenticação da ONT.
// @author       inaciodinucci
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function logar(usuario, senha) {
        const campoUsuario = document.getElementById('txt_Username');
        const campoSenha = document.getElementById('txt_Password');
        const botaoLogin = document.getElementById('loginbutton');
        if (campoUsuario && campoSenha && botaoLogin) {
            campoUsuario.value = usuario;
            campoSenha.value = senha;
            botaoLogin.click();
        }
    }

    function verificarELogar(senha) {
        const productName = document.getElementById('ProductName');
        if (productName && productName.innerText.includes('EG8145X6')) {
            logar('Epadmin', senha);
        }
    }

    document.addEventListener('keydown', function(event) {
        const key = event.key;

        if (key === '-' || key === 'Subtract') {
            verificarELogar('@isp#click');
        } else if (key === '+' || key === 'Add') {
            verificarELogar('adminEp');
        }
    });

    function togglePasswordVisibility() {
        var passwordField = document.getElementById("pwd_2g_wifipwd");
        var currentType = passwordField.type;

        if (currentType === "password") {
            passwordField.type = "text";
        } else {
            passwordField.type = "password";
        }
    }

    function addToggleButton() {
        var passwordField = document.getElementById("pwd_2g_wifipwd");

        if (passwordField) {
            var toggleButton = document.createElement("button");
            toggleButton.textContent = "Show Password";
            toggleButton.type = "button";
            toggleButton.style.marginLeft = "10px";
            toggleButton.onclick = togglePasswordVisibility;

            passwordField.parentNode.appendChild(toggleButton);

            var observer = new MutationObserver(function() {
                if (!document.contains(passwordField)) {
                    toggleButton.remove();
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    window.addEventListener('DOMContentLoaded', addToggleButton);
})();
