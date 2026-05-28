# 03-legal-and-compliance-framework.md — Legal & Compliance Framework

Este documento estabelece o posicionamento jurídico e regulatório da Plataforma V3.1 frente a legislações globais de privacidade de dados, em particular a **LGPD** (Lei Geral de Proteção de Dados - Brasil) e o **GDPR** (General Data Protection Regulation - Europa).

---

## 1. Delimitação de Papéis: Quem é o Controlador de Dados?

A legislação de proteção de dados distingue a figura do **controlador** (quem define a finalidade e os meios de tratamento) da figura do **operador** (quem realiza o tratamento em nome do controlador). Na topologia distribuída da Plataforma V3.1, esses papéis variam conforme a modalidade de rede:

### 1.1 Redes Corporativas Whitelabel
* **Controlador**: A empresa licenciante que opera e governa a rede é a controladora exclusiva de todos os dados de seus funcionários, clientes, parceiros e fornecedores.
* **Operador**: A plataforma (como infraestrutura de software executando nos servidores da empresa ou sob gerência de nuvem isolada) atua estritamente como operadora de dados sob instruções do controlador.

### 1.2 Redes Públicas de Larga Escala
* **Controlador**: O operador da infraestrutura da rede pública (o consórcio fundador, fundação ou board designado) assume o papel de controlador para os dados de cadastro e interação pública dos usuários.
* **Operadores Secundários**: Usuários ou parceiros comerciais que exportam ou integram dados legítimos da rede pública para sistemas externos (como ERPs ou CRMs próprios) tornam-se controladores independentes e secundários sobre essas cópias de dados.

### 1.3 Redes P2P Puras (Descentralizadas)
* **Soberania do Usuário**: Inexistência de uma entidade jurídica centralizadora. Cada usuário humano ou peer é o controlador e operador soberano de seus próprios dados. No onboarding dessas redes, é fornecido um aviso explícito de responsabilidade.

---

## 2. Direitos do Titular de Dados e Primitivas Nativas

A Plataforma V3.1 possui primitivas no seu grafo de dados estruturados para garantir que o controlador atenda aos direitos previstos no artigo 18 da LGPD (e equivalentes do GDPR):

### 2.1 Consentimento de Primeira Classe (`ASSET:CONSENT`)
* O consentimento não é uma configuração implícita em código: é um nó `ASSET:CONSENT` auditável.
* Registra de forma granular e inalterável a finalidade do processamento, a data de concessão, a chave do emitente e permite a revogação instantânea com assinatura do titular.

### 2.2 Requisito de Portabilidade (`CONTENT:INTENT` de Portabilidade)
* O titular pode emitir uma intenção formal solicitando a exportação de seus dados estruturados.
* O sistema compila os nós `CONTENT` descriptografados vinculados ao seu perfil e gera um arquivo JSON estruturado e assinado para autenticação.

### 2.3 Requisito de Exclusão (`CONTENT:INTENT` de Deleção)
* O titular pode solicitar a eliminação de dados tratados sob seu consentimento.
* **Retenção Legal Prevalecente**: Dados protegidos por obrigações legais ou regulatórias (como faturas fiscais `CONTENT:INVOICE` ou registros financeiros `ASSET:BALANCE_STATE` em domínios sujeitos a conformidade de auditoria legal) não são passíveis de exclusão técnica por restrição imposta por `SPECIFICATION`s de conformidade. A plataforma previne a exclusão desses dados e informa formalmente as restrições ao titular.

---

## 3. Limites da Exclusão em Repouso Distribuído (Honestidade Radical)

O paradigma local-first opera sob uma limitação técnica inerente à distribuição de dados: **dados legitimamente baixados por peers autorizados em seus próprios dispositivos locais não podem ser garantidamente apagados pelo operador central**.

### 3.1 Procedimento de Mitigação no Expurgo
Quando um titular solicita a exclusão de dados não protegidos por retenção regulatória, a Plataforma V3.1 executa as seguintes etapas:
1. **Exclusão no Núcleo**: Apaga os payloads e registros das bases de dados centrais do controlador (Cloud Peers, snapshots e buffers públicos).
2. **Rotação de Época (Forward Secrecy)**: Revoga as permissões de acesso (`ASSET:PERMISSION` / `ASSET:ROLE`), disparando a rotação de chaves de época no cofre de chaves. Sem permissão ativa, o titular excluído é impedido de obter as chaves das novas épocas do cofre, tornando os novos dados do grupo matematicamente inacessíveis.
3. **Poda e Expurgo em Peers Ativos**: Propaga a instrução de expurgo (`retention_state = 'expunged'`) para os peers online. Dispositivos de usuários honestos limpam o payload e referências locais de forma automatizada via Sync Worker.
4. **Invalidar Cache**: Invalida o cache volátil em memória dos peers conectados.
5. **Registro de Esforço**: Documenta criptograficamente todas as etapas concluídas e emite uma trilha de auditoria comprovando a ação do controlador.

### 3.2 Limitações Reconhecidas Fora de Controle
* **Peers Offline Prolongados**: Dispositivos que estão offline durante o processo de expurgo manterão suas cópias locais até se conectarem e receberem o comando.
* **Extrações Externas**: Dados que foram intencionalmente capturados por screenshot, exportados via API local por terceiros ou copiados para armazenamento fora do grafo estão fora do alcance de eliminação da plataforma.

Esta postura técnica é equivalente ou superior a qualquer sistema SaaS contemporâneo em nuvem, com a vantagem de que a rotação criptográfica por épocas e as Virtual Foreign Keys (VFK) minimizam os riscos de vazamento futuro de novas transações após a exclusão.
