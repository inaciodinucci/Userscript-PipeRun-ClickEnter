# ClickEnter Utilities

Extensão para Tampermonkey projetada para otimizar o fluxo de atendimento no PipeRun (ClickEnter), fornecendo ferramentas de monitoramento, automação com inteligência artificial e organização de dados.

## Funcionalidades Principais

### Monitoramento de TMA (Tempo Médio de Atendimento)
- Cálculo automático do tempo de permanência em cada atendimento.
- Indicadores visuais na barra lateral: borda laranja para alerta (padrão 35 min) e borda vermelha para crítico (padrão 60 min).
- Notificações nativas do navegador e alertas sonoros quando um atendimento excede 1 hora.

### Relato Automatizado com I.A.
- Geração de resumos técnicos de atendimento utilizando Gemini (Google) ou ChatGPT (OpenAI).
- O algoritmo prioriza anotações feitas pelo atendente e utiliza o histórico do chat como contexto secundário.
- Saída formatada em primeira pessoa, pronta para ser copiada para o sistema de CRM.

### Cronômetro Individual por Cliente
- Configuração de timers personalizados para cada aba de atendimento.
- Notificações sonoras e visuais ao término do tempo configurado.
- Persistência do estado do timer ao alternar entre diferentes atendimentos.

### Gestão de Lembretes e Notas
- Campo de anotações rápidas vinculadas especificamente ao cliente em atendimento.
- Dados salvos localmente, servindo de base para a geração do relato por I.A.

### Mensagens Prontas
- Repositório de textos frequentes para resposta rápida.
- Atalhos de cópia com um clique para agilizar a comunicação.

### Interface Adaptável
- Painel lateral expansível com dois modos de visualização:
  - **Overlay**: Painel flutuante sobre a interface.
  - **Integrated**: Integração direta ao lado do chat, redimensionando a área principal.
- Largura do painel ajustável manualmente.

## Instalação e Atualização

### Instalação Inicial
1. Certifique-se de ter a extensão Tampermonkey instalada no navegador.
2. Adicione o script `ClickEnter-Utilities.user.js` ao painel do Tampermonkey.

### Sistema de Atualização (WIP)
A extensão possui um verificador de versão integrado que consulta o repositório oficial no GitHub.
- Quando uma nova versão é detectada, o botão "ATUALIZAR" aparecerá no cabeçalho do painel.
- O processo de atualização é gerenciado nativamente pelo Tampermonkey ao clicar no botão.

## Configuração Técnico-Operacional

Acesse o ícone de engrenagem no painel para configurar:
- Chaves de API (Gemini ou OpenAI) para os recursos de I.A.
- Limites de tempo para alertas e avisos críticos de TMA.
- Preferências de interface e largura padrão do painel.
