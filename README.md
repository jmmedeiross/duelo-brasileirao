# Duelo Brasileirão ⚽

Comparador de jogadores do **Brasileirão Série A 2026** que reúne estatísticas de desempenho e permite analisar dois atletas lado a lado.

O projeto possui front-end responsivo, backend em Node.js, integração com dados do FotMob e visualização em gráfico radar com Chart.js.

## Funcionalidades

- seleção de dois clubes e dois jogadores;
- filtro por posição;
- comparação da temporada completa;
- comparação pelas últimas 5 ou 10 aparições do jogador;
- gráfico radar com gols, assistências, passes, finalizações, desarmes e chutes no alvo;
- tabela com números absolutos, minutos e cartões;
- lista das partidas usadas nos filtros de últimos jogos;
- data, placar, adversários, minutos, gols e assistências das partidas consideradas;
- cache em memória para reduzir chamadas repetidas à fonte;
- fallbacks para lidar com diferentes formatos de resposta;
- endpoints opcionais de diagnóstico para desenvolvimento.

## Tecnologias

- **Node.js** — servidor HTTP e integração com a fonte de dados
- **JavaScript** — lógica do front-end e tratamento dos dados
- **HTML5 / CSS3** — interface responsiva
- **Chart.js** — gráfico radar
- **FotMob** — fonte externa de dados de futebol
- **GitHub Actions** — validação automática de sintaxe

## Arquitetura

```mermaid
flowchart LR
    A[FotMob] --> B[Node.js / server.js]
    B --> C[/api/teams]
    B --> D[/api/squad]
    B --> E[/api/player-stats]
    C --> F[Front-end]
    D --> F
    E --> F
    F --> G[Comparação + Radar + Jogos considerados]
```

## Como executar

### Requisitos

- Node.js 20 ou superior

Clone o repositório e entre na pasta:

```bash
git clone https://github.com/jmmedeiross/duelo-brasileirao.git
cd duelo-brasileirao
```

Inicie o servidor:

```bash
npm start
```

Abra no navegador:

```text
http://localhost:3001
```

Não é necessário instalar dependências npm para a aplicação principal.

## Configuração opcional

O projeto funciona com valores padrão, mas aceita variáveis de ambiente:

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3001` | Porta do servidor local |
| `SEASON` | `2026` | Ano exibido e consultado |
| `FOTMOB_LEAGUE_ID` | `268` | ID da Série A no FotMob |
| `FOTMOB_SEASON_ID` | `1000000388` | ID interno da temporada |
| `FOTMOB_API_BASE` | automático | URL base alternativa |
| `ENABLE_DEBUG_ROUTES` | `false` | Habilita `/api/debug-*` |

No PowerShell, por exemplo:

```powershell
$env:PORT=3002
npm.cmd start
```

## Endpoints locais

```text
GET /api/health
GET /api/teams
GET /api/squad?team=TEAM_ID
GET /api/player-stats?player=PLAYER_ID&team=TEAM_ID&period=season
GET /api/player-stats?player=PLAYER_ID&team=TEAM_ID&period=last5
GET /api/player-stats?player=PLAYER_ID&team=TEAM_ID&period=last10
```

Com `ENABLE_DEBUG_ROUTES=true`:

```text
GET /api/debug-source
GET /api/debug-team?team=TEAM_ID
```

## Como funciona o radar

As métricas possuem escalas muito diferentes. Um jogador pode ter mais de mil passes e apenas alguns gols. Por isso, o radar normaliza cada métrica entre os dois atletas para uma escala visual de **0 a 100**.

Os valores absolutos continuam disponíveis na tabela logo abaixo do gráfico.

## Últimos jogos

Nos filtros de **últimos 5** e **últimos 10 jogos**, o sistema procura as últimas aparições confirmadas do jogador na Série A e soma apenas as estatísticas dessas partidas.

A interface também exibe as partidas utilizadas no cálculo para que seja possível conferir a origem dos números.

## Estrutura do projeto

```text
duelo-brasileirao/
├── .github/
│   └── workflows/
│       └── ci.yml
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── .editorconfig
├── .env.example
├── .gitignore
├── LICENSE
├── package.json
├── README.md
└── server.js
```

## Validação

Para verificar a sintaxe dos arquivos JavaScript:

```bash
npm test
```

O mesmo comando é executado automaticamente pelo GitHub Actions em pushes e pull requests para `main`.

## Observações sobre a fonte de dados

Este é um projeto independente de portfólio e **não possui vínculo oficial com o FotMob**.

A aplicação consulta endpoints utilizados pela plataforma web do provedor. Como esses endpoints não fazem parte de uma API pública contratualmente estável, seu formato ou disponibilidade podem mudar. O backend inclui cache, tratamento de erros e fallbacks para reduzir o impacto dessas alterações.

O uso e a redistribuição dos dados devem respeitar os termos aplicáveis do provedor.

## Licença

Código disponibilizado sob a licença [MIT](LICENSE).
