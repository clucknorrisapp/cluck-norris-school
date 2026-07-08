// Data-driven renderer for the /learn/<asset> education pages — MULTILINGUAL.
// English content lives in data/learn-assets.json (produced by the research workflow);
// translations live in data/learn-assets.<lang>.json (same shape, translated fields only)
// and are overlay-merged onto the English base by server.js before rendering. This module
// turns a (possibly merged) content object into a full, house-styled HTML page (+ a hub
// index) in the requested language: UI chrome comes from the L dict below, URLs are
// path-prefixed (/learn/es/sol), and every page carries hreflang alternates for SEO.
// All content is escaped before it hits HTML.

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// The school's 7 languages. 'en' is canonical (no URL prefix); the rest are prefixed.
const LEARN_LANGS = ["en", "es", "it", "pt", "vi", "zh", "hi"];
const LANG_LABELS = { en: "EN", es: "ES", it: "IT", pt: "PT", vi: "VI", zh: "中文", hi: "हिंदी" };

// UI chrome strings per language. Content comes translated from the data files;
// these cover everything the TEMPLATE itself says.
const L = {
  en: {
    whatIs: (n) => `What is ${n}?`, how: "How it works", building: "What they're building",
    facts: "Quick facts", eco: "The ecosystem", history: "History", risks: "The honest risks",
    invest: "How to invest (safely)", askTitle: (n) => `Ask Cluck about ${n}`,
    askSub: "Stuck on something above? Ask the professor — he answers in plain English.",
    askPlaceholder: (n) => `Ask anything about ${n}…`, askBtn: "Ask",
    sugg1: "vs. Bitcoin?", sugg2: "Biggest risks?", sugg3: "Store it safely?",
    suggQ1: (n) => `In simple terms, what makes ${n} different from Bitcoin?`,
    suggQ2: (n) => `What are the biggest risks of holding ${n}?`,
    suggQ3: (n) => `How do I store ${n} safely?`,
    thinking: "Cluck is thinking…", commsDown: "Comms down — try again.",
    ctaTitle: "Learn crypto the hard-knocks way",
    ctaBody: (n) => `Understanding ${n} is one step. The Cluck Norris school teaches wallets, DeFi, scams, and self-custody for free — with a verifiable diploma when you pass.`,
    ctaSchool: "Start the free school", ctaTools: "Free token tools", allChains: "All chains →",
    price: "PRICE (USD)", change: "24H CHANGE", mcap: "MARKET CAP",
    title: (n, t) => `What is ${n} (${t})? — Cluck Norris Crypto School`,
    desc: (n, t) => `${n} (${t}) explained without the hype: how it works, what the team is building, the honest risks, and how to get started. Free crypto education.`,
    og: (n, t) => `What is ${n} (${t})? — plain-English breakdown`,
    ogDesc: (n) => `How ${n} actually works, what it's building, the real risks, and where to start. No hype.`,
    hubTitle: "Learn Crypto — Every Chain, Explained | Cluck Norris School",
    hubH1: "Learn Crypto",
    hubDesc: "Plain-English guides to Bitcoin, Ethereum, Solana, XRP, and every top crypto asset. How they work, what they're building, the honest risks. Free.",
    hubTagline: "Every top chain and project, explained in plain English — how it works, what it's building, and the honest risks. No hype, no shilling.",
    hubPick: "Pick an asset", hubCtaTitle: "Ready to go deeper?",
    hubCtaBody: "The free school turns this knowledge into real skills — wallets, DeFi, scams, self-custody — with a verifiable diploma.",
    disclaimer: "Educational content only — not financial advice. Crypto is volatile and risky; do your own research and never risk more than you can afford to lose.",
  },
  es: {
    whatIs: (n) => `¿Qué es ${n}?`, how: "Cómo funciona", building: "Qué están construyendo",
    facts: "Datos rápidos", eco: "El ecosistema", history: "Historia", risks: "Los riesgos, sin filtros",
    invest: "Cómo invertir (con cabeza)", askTitle: (n) => `Pregúntale a Cluck sobre ${n}`,
    askSub: "¿Algo no te cuadra? Pregúntale al profesor — responde en lenguaje claro.",
    askPlaceholder: (n) => `Pregunta lo que quieras sobre ${n}…`, askBtn: "Preguntar",
    sugg1: "¿vs. Bitcoin?", sugg2: "¿Mayores riesgos?", sugg3: "¿Cómo guardarlo?",
    suggQ1: (n) => `En términos simples, ¿qué hace diferente a ${n} de Bitcoin?`,
    suggQ2: (n) => `¿Cuáles son los mayores riesgos de tener ${n}?`,
    suggQ3: (n) => `¿Cómo guardo ${n} de forma segura?`,
    thinking: "Cluck está pensando…", commsDown: "Sin conexión — inténtalo de nuevo.",
    ctaTitle: "Aprende cripto a la escuela de los golpes",
    ctaBody: (n) => `Entender ${n} es solo un paso. La escuela de Cluck Norris enseña wallets, DeFi, estafas y autocustodia gratis — con un diploma verificable al aprobar.`,
    ctaSchool: "Empieza la escuela gratis", ctaTools: "Herramientas gratis", allChains: "Todas las chains →",
    price: "PRECIO (USD)", change: "CAMBIO 24H", mcap: "CAP. DE MERCADO",
    title: (n, t) => `¿Qué es ${n} (${t})? — Escuela Cripto Cluck Norris`,
    desc: (n, t) => `${n} (${t}) explicado sin humo: cómo funciona, qué está construyendo el equipo, los riesgos honestos y cómo empezar. Educación cripto gratis.`,
    og: (n, t) => `¿Qué es ${n} (${t})? — explicado en claro`,
    ogDesc: (n) => `Cómo funciona ${n} de verdad, qué está construyendo, los riesgos reales y por dónde empezar. Sin humo.`,
    hubTitle: "Aprende Cripto — Cada Chain, Explicada | Escuela Cluck Norris",
    hubH1: "Aprende Cripto",
    hubDesc: "Guías en lenguaje claro de Bitcoin, Ethereum, Solana, XRP y los principales activos cripto. Cómo funcionan, qué construyen, los riesgos honestos. Gratis.",
    hubTagline: "Cada chain y proyecto importante, explicado en lenguaje claro — cómo funciona, qué construye y los riesgos honestos. Sin humo, sin shilling.",
    hubPick: "Elige un activo", hubCtaTitle: "¿Listo para ir más a fondo?",
    hubCtaBody: "La escuela gratis convierte este conocimiento en habilidades reales — wallets, DeFi, estafas, autocustodia — con un diploma verificable.",
    disclaimer: "Contenido educativo — no es asesoría financiera. Las cripto son volátiles y arriesgadas; investiga por tu cuenta y nunca arriesgues más de lo que puedas perder.",
  },
  it: {
    whatIs: (n) => `Cos'è ${n}?`, how: "Come funziona", building: "Cosa stanno costruendo",
    facts: "Fatti rapidi", eco: "L'ecosistema", history: "Storia", risks: "I rischi, detti onestamente",
    invest: "Come investire (in sicurezza)", askTitle: (n) => `Chiedi a Cluck di ${n}`,
    askSub: "Qualcosa non ti torna? Chiedi al professore — risponde in parole semplici.",
    askPlaceholder: (n) => `Chiedi qualsiasi cosa su ${n}…`, askBtn: "Chiedi",
    sugg1: "vs. Bitcoin?", sugg2: "Rischi principali?", sugg3: "Come custodirlo?",
    suggQ1: (n) => `In parole semplici, cosa rende ${n} diverso da Bitcoin?`,
    suggQ2: (n) => `Quali sono i rischi principali nel detenere ${n}?`,
    suggQ3: (n) => `Come custodisco ${n} in modo sicuro?`,
    thinking: "Cluck sta pensando…", commsDown: "Connessione assente — riprova.",
    ctaTitle: "Impara le cripto alla scuola dei duri colpi",
    ctaBody: (n) => `Capire ${n} è solo un passo. La scuola di Cluck Norris insegna wallet, DeFi, truffe e autocustodia gratis — con un diploma verificabile quando passi.`,
    ctaSchool: "Inizia la scuola gratuita", ctaTools: "Strumenti gratuiti", allChains: "Tutte le chain →",
    price: "PREZZO (USD)", change: "VARIAZIONE 24H", mcap: "CAP. DI MERCATO",
    title: (n, t) => `Cos'è ${n} (${t})? — Scuola Crypto Cluck Norris`,
    desc: (n, t) => `${n} (${t}) spiegato senza hype: come funziona, cosa sta costruendo il team, i rischi onesti e come iniziare. Educazione crypto gratuita.`,
    og: (n, t) => `Cos'è ${n} (${t})? — spiegato in parole semplici`,
    ogDesc: (n) => `Come funziona davvero ${n}, cosa sta costruendo, i rischi reali e da dove iniziare. Zero hype.`,
    hubTitle: "Impara le Crypto — Ogni Chain, Spiegata | Scuola Cluck Norris",
    hubH1: "Impara le Crypto",
    hubDesc: "Guide in parole semplici a Bitcoin, Ethereum, Solana, XRP e ai principali asset crypto. Come funzionano, cosa costruiscono, i rischi onesti. Gratis.",
    hubTagline: "Ogni chain e progetto importante, spiegato in parole semplici — come funziona, cosa costruisce e i rischi onesti. Niente hype, niente shilling.",
    hubPick: "Scegli un asset", hubCtaTitle: "Pronto ad andare più a fondo?",
    hubCtaBody: "La scuola gratuita trasforma questa conoscenza in competenze reali — wallet, DeFi, truffe, autocustodia — con un diploma verificabile.",
    disclaimer: "Contenuto educativo — non è consulenza finanziaria. Le cripto sono volatili e rischiose; fai le tue ricerche e non rischiare mai più di quanto puoi permetterti di perdere.",
  },
  pt: {
    whatIs: (n) => `O que é ${n}?`, how: "Como funciona", building: "O que estão construindo",
    facts: "Fatos rápidos", eco: "O ecossistema", history: "História", risks: "Os riscos, com honestidade",
    invest: "Como investir (com segurança)", askTitle: (n) => `Pergunte ao Cluck sobre ${n}`,
    askSub: "Travou em algo? Pergunte ao professor — ele responde em linguagem simples.",
    askPlaceholder: (n) => `Pergunte qualquer coisa sobre ${n}…`, askBtn: "Perguntar",
    sugg1: "vs. Bitcoin?", sugg2: "Maiores riscos?", sugg3: "Como guardar?",
    suggQ1: (n) => `Em termos simples, o que torna ${n} diferente do Bitcoin?`,
    suggQ2: (n) => `Quais são os maiores riscos de manter ${n}?`,
    suggQ3: (n) => `Como guardo ${n} com segurança?`,
    thinking: "Cluck está pensando…", commsDown: "Sem conexão — tente de novo.",
    ctaTitle: "Aprenda cripto na escola da porrada",
    ctaBody: (n) => `Entender ${n} é só um passo. A escola do Cluck Norris ensina wallets, DeFi, golpes e autocustódia de graça — com um diploma verificável quando você passa.`,
    ctaSchool: "Comece a escola grátis", ctaTools: "Ferramentas grátis", allChains: "Todas as chains →",
    price: "PREÇO (USD)", change: "VARIAÇÃO 24H", mcap: "CAP. DE MERCADO",
    title: (n, t) => `O que é ${n} (${t})? — Escola Cripto Cluck Norris`,
    desc: (n, t) => `${n} (${t}) explicado sem hype: como funciona, o que a equipe está construindo, os riscos honestos e como começar. Educação cripto grátis.`,
    og: (n, t) => `O que é ${n} (${t})? — explicado em bom português`,
    ogDesc: (n) => `Como ${n} funciona de verdade, o que está construindo, os riscos reais e por onde começar. Sem hype.`,
    hubTitle: "Aprenda Cripto — Cada Chain, Explicada | Escola Cluck Norris",
    hubH1: "Aprenda Cripto",
    hubDesc: "Guias em linguagem simples de Bitcoin, Ethereum, Solana, XRP e os principais ativos cripto. Como funcionam, o que constroem, os riscos honestos. Grátis.",
    hubTagline: "Cada chain e projeto importante, explicado em linguagem simples — como funciona, o que constrói e os riscos honestos. Sem hype, sem shilling.",
    hubPick: "Escolha um ativo", hubCtaTitle: "Pronto para ir mais fundo?",
    hubCtaBody: "A escola grátis transforma esse conhecimento em habilidades reais — wallets, DeFi, golpes, autocustódia — com um diploma verificável.",
    disclaimer: "Conteúdo educativo — não é aconselhamento financeiro. Cripto é volátil e arriscado; pesquise por conta própria e nunca arrisque mais do que pode perder.",
  },
  vi: {
    whatIs: (n) => `${n} là gì?`, how: "Cách hoạt động", building: "Họ đang xây dựng gì",
    facts: "Thông tin nhanh", eco: "Hệ sinh thái", history: "Lịch sử", risks: "Rủi ro, nói thẳng",
    invest: "Cách đầu tư (an toàn)", askTitle: (n) => `Hỏi Cluck về ${n}`,
    askSub: "Chưa hiểu chỗ nào? Hỏi giáo sư — trả lời bằng ngôn ngữ dễ hiểu.",
    askPlaceholder: (n) => `Hỏi bất cứ điều gì về ${n}…`, askBtn: "Hỏi",
    sugg1: "so với Bitcoin?", sugg2: "Rủi ro lớn nhất?", sugg3: "Lưu trữ an toàn?",
    suggQ1: (n) => `Nói đơn giản, ${n} khác Bitcoin ở điểm nào?`,
    suggQ2: (n) => `Những rủi ro lớn nhất khi nắm giữ ${n} là gì?`,
    suggQ3: (n) => `Làm sao để lưu trữ ${n} an toàn?`,
    thinking: "Cluck đang suy nghĩ…", commsDown: "Mất kết nối — thử lại.",
    ctaTitle: "Học crypto kiểu trường đời",
    ctaBody: (n) => `Hiểu ${n} mới chỉ là một bước. Trường Cluck Norris dạy ví, DeFi, lừa đảo và tự lưu ký miễn phí — kèm bằng tốt nghiệp xác minh được khi bạn đậu.`,
    ctaSchool: "Bắt đầu học miễn phí", ctaTools: "Công cụ miễn phí", allChains: "Tất cả các chain →",
    price: "GIÁ (USD)", change: "THAY ĐỔI 24H", mcap: "VỐN HÓA",
    title: (n, t) => `${n} (${t}) là gì? — Trường Crypto Cluck Norris`,
    desc: (n, t) => `${n} (${t}) giải thích không thổi phồng: cách hoạt động, đội ngũ đang xây gì, rủi ro thẳng thắn và cách bắt đầu. Giáo dục crypto miễn phí.`,
    og: (n, t) => `${n} (${t}) là gì? — giải thích dễ hiểu`,
    ogDesc: (n) => `${n} thực sự hoạt động ra sao, đang xây dựng gì, rủi ro thật và bắt đầu từ đâu. Không thổi phồng.`,
    hubTitle: "Học Crypto — Mọi Chain, Giải Thích Rõ | Trường Cluck Norris",
    hubH1: "Học Crypto",
    hubDesc: "Hướng dẫn dễ hiểu về Bitcoin, Ethereum, Solana, XRP và mọi tài sản crypto hàng đầu. Cách hoạt động, đang xây gì, rủi ro thẳng thắn. Miễn phí.",
    hubTagline: "Mọi chain và dự án hàng đầu, giải thích bằng ngôn ngữ dễ hiểu — cách hoạt động, đang xây gì và rủi ro thẳng thắn. Không hype, không shill.",
    hubPick: "Chọn một tài sản", hubCtaTitle: "Sẵn sàng tìm hiểu sâu hơn?",
    hubCtaBody: "Trường miễn phí biến kiến thức này thành kỹ năng thật — ví, DeFi, lừa đảo, tự lưu ký — kèm bằng tốt nghiệp xác minh được.",
    disclaimer: "Nội dung giáo dục — không phải lời khuyên tài chính. Crypto biến động và rủi ro; tự nghiên cứu và đừng bao giờ mạo hiểm nhiều hơn số tiền bạn có thể mất.",
  },
  zh: {
    whatIs: (n) => `什么是${n}？`, how: "运作原理", building: "他们正在构建什么",
    facts: "快速要点", eco: "生态系统", history: "发展历程", risks: "诚实的风险",
    invest: "如何（安全地）投资", askTitle: (n) => `向Cluck提问：${n}`,
    askSub: "上面有不懂的？问教授——他用大白话回答。",
    askPlaceholder: (n) => `关于${n}，随便问…`, askBtn: "提问",
    sugg1: "和比特币比？", sugg2: "最大风险？", sugg3: "如何安全保管？",
    suggQ1: (n) => `用简单的话说，${n}和比特币有什么不同？`,
    suggQ2: (n) => `持有${n}最大的风险是什么？`,
    suggQ3: (n) => `如何安全地保管${n}？`,
    thinking: "Cluck思考中…", commsDown: "连接失败——请重试。",
    ctaTitle: "用「硬核学堂」的方式学加密",
    ctaBody: (n) => `理解${n}只是第一步。Cluck Norris学堂免费教你钱包、DeFi、防骗和自托管——通过考试还能拿到可验证的毕业证书。`,
    ctaSchool: "免费开始学习", ctaTools: "免费代币工具", allChains: "全部链 →",
    price: "价格 (USD)", change: "24小时涨跌", mcap: "市值",
    title: (n, t) => `什么是${n}（${t}）？— Cluck Norris 加密学堂`,
    desc: (n, t) => `不吹不黑讲清楚${n}（${t}）：运作原理、团队正在构建什么、诚实的风险以及如何入门。免费加密教育。`,
    og: (n, t) => `什么是${n}（${t}）？— 大白话讲解`,
    ogDesc: (n) => `${n}究竟如何运作、正在构建什么、真实的风险以及从哪里开始。不吹不黑。`,
    hubTitle: "学加密 — 每条链都讲明白 | Cluck Norris 学堂",
    hubH1: "学加密",
    hubDesc: "用大白话讲解比特币、以太坊、Solana、XRP等所有主流加密资产。运作原理、在建什么、诚实的风险。免费。",
    hubTagline: "每条主流链和项目，用大白话讲明白——运作原理、在建什么、诚实的风险。不吹捧，不喊单。",
    hubPick: "选择一个资产", hubCtaTitle: "想学得更深入？",
    hubCtaBody: "免费学堂把这些知识变成真本事——钱包、DeFi、防骗、自托管——还有可验证的毕业证书。",
    disclaimer: "仅为教育内容，不构成财务建议。加密货币波动大、风险高；请自行研究，切勿投入超过承受能力的资金。",
  },
  hi: {
    whatIs: (n) => `${n} क्या है?`, how: "यह कैसे काम करता है", building: "वे अभी क्या बना रहे हैं",
    facts: "झटपट तथ्य", eco: "इकोसिस्टम", history: "इतिहास", risks: "ईमानदार जोखिम",
    invest: "(सुरक्षित) निवेश कैसे करें", askTitle: (n) => `Cluck से ${n} के बारे में पूछें`,
    askSub: "कुछ समझ नहीं आया? प्रोफेसर से पूछें — आसान भाषा में जवाब मिलेगा।",
    askPlaceholder: (n) => `${n} के बारे में कुछ भी पूछें…`, askBtn: "पूछें",
    sugg1: "बनाम Bitcoin?", sugg2: "सबसे बड़े जोखिम?", sugg3: "सुरक्षित कैसे रखें?",
    suggQ1: (n) => `आसान शब्दों में, ${n} Bitcoin से कैसे अलग है?`,
    suggQ2: (n) => `${n} रखने के सबसे बड़े जोखिम क्या हैं?`,
    suggQ3: (n) => `${n} को सुरक्षित कैसे रखूं?`,
    thinking: "Cluck सोच रहा है…", commsDown: "कनेक्शन नहीं — फिर कोशिश करें।",
    ctaTitle: "क्रिप्टो सीखें, ठोकरों वाले स्कूल से",
    ctaBody: (n) => `${n} को समझना बस एक कदम है। Cluck Norris स्कूल मुफ़्त में वॉलेट, DeFi, स्कैम और सेल्फ-कस्टडी सिखाता है — पास होने पर वेरिफ़ाई होने वाला डिप्लोमा भी।`,
    ctaSchool: "मुफ़्त स्कूल शुरू करें", ctaTools: "मुफ़्त टोकन टूल्स", allChains: "सभी चेन →",
    price: "क़ीमत (USD)", change: "24 घंटे बदलाव", mcap: "मार्केट कैप",
    title: (n, t) => `${n} (${t}) क्या है? — Cluck Norris क्रिप्टो स्कूल`,
    desc: (n, t) => `${n} (${t}) बिना हाइप के समझाया गया: यह कैसे काम करता है, टीम क्या बना रही है, ईमानदार जोखिम और शुरुआत कैसे करें। मुफ़्त क्रिप्टो शिक्षा।`,
    og: (n, t) => `${n} (${t}) क्या है? — आसान भाषा में`,
    ogDesc: (n) => `${n} असल में कैसे काम करता है, क्या बना रहा है, असली जोखिम और कहां से शुरू करें। बिना हाइप।`,
    hubTitle: "क्रिप्टो सीखें — हर चेन, आसान भाषा में | Cluck Norris स्कूल",
    hubH1: "क्रिप्टो सीखें",
    hubDesc: "Bitcoin, Ethereum, Solana, XRP और हर बड़े क्रिप्टो एसेट की आसान भाषा में गाइड। कैसे काम करते हैं, क्या बना रहे हैं, ईमानदार जोखिम। मुफ़्त।",
    hubTagline: "हर बड़ी चेन और प्रोजेक्ट, आसान भाषा में — कैसे काम करता है, क्या बना रहा है, और ईमानदार जोखिम। न हाइप, न शिलिंग।",
    hubPick: "एक एसेट चुनें", hubCtaTitle: "और गहराई में जाना है?",
    hubCtaBody: "मुफ़्त स्कूल इस ज्ञान को असली हुनर में बदलता है — वॉलेट, DeFi, स्कैम, सेल्फ-कस्टडी — वेरिफ़ाई होने वाले डिप्लोमा के साथ।",
    disclaimer: "केवल शैक्षिक सामग्री — वित्तीय सलाह नहीं। क्रिप्टो अस्थिर और जोखिम भरा है; अपनी रिसर्च करें और उतना ही लगाएं जितना खोने की क्षमता हो।",
  },
};

function urlFor(lang, slug) {
  const tail = slug ? `/${slug}` : "";
  return lang === "en" ? `/learn${tail}` : `/learn/${lang}${tail}`;
}
// `langs` = the languages actually available (English always + any with a complete
// translation file). Only these are advertised in hreflang + the switcher, so an
// unfinished translation never gets offered (it still serves via fallback if visited).
function hreflangs(slug, langs) {
  const links = (langs || ["en"]).map((lg) =>
    `<link rel="alternate" hreflang="${lg}" href="https://clucknorris.app${urlFor(lg, slug)}"/>`).join("\n");
  return links + `\n<link rel="alternate" hreflang="x-default" href="https://clucknorris.app${urlFor("en", slug)}"/>`;
}
function langSwitcher(lang, slug, langs) {
  langs = langs || ["en"];
  if (langs.length < 2) return ""; // nothing to switch to — hide the row
  return `<div class="lang-row">${langs.map((lg) =>
    lg === lang
      ? `<span class="lang-pill on">${LANG_LABELS[lg] || lg}</span>`
      : `<a class="lang-pill" href="${urlFor(lg, slug)}">${LANG_LABELS[lg] || lg}</a>`).join("")}</div>`;
}

const SHARED_CSS = `
  :root{color-scheme:dark;--bg:#0b0c0e;--card:#14151a;--border:rgba(255,255,255,0.09);--text:#FFEFE0;--body-text:#EAD8C8;--sub:#C9A892;--muted:#9C7E68;--accent:#FFB627;--orange:#FF7A18;--green:#7BE26B;--red:#E81E0E;--head:'Anton',sans-serif;--body:'Chakra Petch',system-ui,sans-serif;--mono:ui-monospace,'Share Tech Mono',monospace;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:var(--body);min-height:100vh;line-height:1.6;}
  .wrap{max-width:820px;margin:0 auto;padding:24px 16px 80px;}
  a{color:var(--accent);}
  .hero{background:linear-gradient(160deg,#16171d,#101116);border:1px solid var(--border);border-radius:16px;padding:26px 24px;margin-bottom:18px;position:relative;overflow:hidden;}
  .hero::after{content:"";position:absolute;top:-40%;right:-10%;width:280px;height:280px;background:radial-gradient(circle,var(--glow,rgba(255,182,39,0.18)),transparent 70%);pointer-events:none;}
  .brand-mini{font-family:var(--head);font-size:10px;letter-spacing:4px;color:var(--orange);margin-bottom:10px;}
  .brand-mini a{color:var(--orange);text-decoration:none;}
  .hero-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
  .coin-badge{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--head);font-size:18px;color:#fff;flex-shrink:0;text-shadow:0 1px 3px rgba(0,0,0,.5);}
  .hero h1{font-family:var(--head);font-size:34px;letter-spacing:2px;line-height:1;}
  .hero .ticker{font-family:var(--mono);font-size:13px;color:var(--sub);letter-spacing:1px;margin-top:4px;}
  .hero .tagline{color:var(--body-text);margin-top:14px;font-size:15px;max-width:640px;}
  .lang-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px;position:relative;z-index:1;}
  .lang-pill{font-family:var(--mono);font-size:10px;letter-spacing:1px;color:var(--sub);background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:14px;padding:4px 10px;text-decoration:none;}
  .lang-pill:hover{border-color:var(--accent);color:var(--accent);}
  .lang-pill.on{border-color:var(--accent);color:var(--accent);background:rgba(255,182,39,0.10);}
  .price-strip{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 22px;}
  .price-box{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:11px 16px;flex:1;min-width:120px;}
  .price-box .lbl{font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:1px;}
  .price-box .val{font-family:var(--mono);font-size:19px;font-weight:700;color:var(--accent);margin-top:3px;}
  .price-box .val.green{color:var(--green);}.price-box .val.red{color:var(--red);}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px 22px;margin-bottom:16px;}
  .card h2{font-family:var(--head);font-size:20px;letter-spacing:1px;margin-bottom:12px;color:var(--text);}
  .card p{color:var(--body-text);margin-bottom:12px;}
  .card p:last-child{margin-bottom:0;}
  .card ul{margin:6px 0 4px 4px;list-style:none;}
  .card li{color:var(--body-text);padding-left:20px;position:relative;margin-bottom:8px;}
  .card li::before{content:"\\25B8";position:absolute;left:0;color:var(--orange);}
  strong{color:var(--text);}
  .facts{width:100%;border-collapse:collapse;}
  .facts td{padding:9px 6px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:14px;vertical-align:top;}
  .facts td:first-child{font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:1px;width:40%;text-transform:uppercase;}
  .facts td:last-child{color:var(--body-text);}
  .timeline{list-style:none;}
  .timeline li{padding-left:64px;position:relative;margin-bottom:12px;color:var(--body-text);}
  .timeline li::before{content:none;}
  .timeline .yr{position:absolute;left:0;top:0;font-family:var(--mono);font-size:12px;color:var(--accent);font-weight:700;}
  .risk{background:rgba(232,30,14,0.06);border:1px solid rgba(232,30,14,0.22);border-radius:12px;padding:20px 22px;margin-bottom:16px;}
  .risk h2{color:#FF8A7A;}
  .risk li::before{color:var(--red);}
  .cta{background:linear-gradient(160deg,#1a1408,#14151a);border:1px solid rgba(255,182,39,0.28);border-radius:14px;padding:24px;text-align:center;margin-bottom:16px;}
  .cta h2{font-family:var(--head);font-size:22px;letter-spacing:1px;margin-bottom:8px;}
  .cta p{color:var(--body-text);margin-bottom:16px;}
  .btn-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}
  .btn{background:var(--orange);color:#fff;text-decoration:none;font-family:var(--head);font-size:14px;letter-spacing:1px;padding:12px 22px;border-radius:10px;}
  .btn.ghost{background:transparent;border:1px solid var(--border);color:var(--text);}
  .chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:14px;justify-content:center;}
  .chip{font-family:var(--mono);font-size:11px;color:var(--sub);background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:20px;padding:5px 12px;text-decoration:none;}
  .chip:hover{border-color:var(--accent);color:var(--accent);}
  .footer-tag{text-align:center;margin-top:30px;padding-top:20px;border-top:1px solid var(--border);font-family:var(--head);font-size:10px;color:var(--sub);letter-spacing:3px;}
  .footer-tag a{color:var(--orange);text-decoration:none;}
  .disclaimer{font-size:11px;color:var(--muted);text-align:center;margin-top:14px;line-height:1.5;}
  .hub-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:8px;}
  .hub-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;text-decoration:none;display:flex;align-items:center;gap:12px;transition:border-color .15s;}
  .hub-card:hover{border-color:var(--accent);}
  .hub-card .b{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--head);font-size:13px;color:#fff;flex-shrink:0;}
  .hub-card .n{font-family:var(--head);font-size:15px;color:var(--text);letter-spacing:1px;}
  .hub-card .t{font-family:var(--mono);font-size:10px;color:var(--muted);}
  .ask{background:linear-gradient(160deg,#131820,#101116);border:1px solid rgba(255,182,39,0.22);border-radius:14px;padding:20px 22px;margin-bottom:16px;}
  .ask h2{font-family:var(--head);font-size:20px;letter-spacing:1px;margin-bottom:6px;}
  .ask .sub{color:var(--sub);font-size:13px;margin-bottom:14px;}
  .ask-sugg{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px;}
  .ask-sugg button{font-family:var(--mono);font-size:11px;color:var(--sub);background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:20px;padding:6px 12px;cursor:pointer;}
  .ask-sugg button:hover{border-color:var(--accent);color:var(--accent);}
  .ask-form{display:flex;gap:8px;}
  .ask-form input{flex:1;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-family:var(--body);font-size:14px;color:var(--text);}
  .ask-form input:focus{outline:none;border-color:var(--accent);}
  .ask-form button{background:var(--orange);border:none;border-radius:10px;padding:0 20px;font-family:var(--head);font-size:14px;letter-spacing:1px;color:#fff;cursor:pointer;}
  .ask-form button:disabled{opacity:.5;cursor:not-allowed;}
  .ask-ans{margin-top:14px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;color:var(--body-text);font-size:14px;white-space:pre-wrap;display:none;}
  .ask-ans.show{display:block;}
  .ask-ans .who{font-family:var(--head);font-size:11px;letter-spacing:2px;color:var(--accent);margin-bottom:6px;}
`;

const HEAD = (lang, title, desc, ogTitle, ogDesc, glow, slug, langs) => `<!DOCTYPE html><html lang="${esc(lang)}"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta property="og:title" content="${esc(ogTitle)}"/>
<meta property="og:description" content="${esc(ogDesc)}"/>
<meta property="og:image" content="https://clucknorris.app/cluck-norris-mascot.jpg"/>
<meta property="og:type" content="article"/>
<meta name="twitter:card" content="summary_large_image"/>
<link rel="canonical" href="https://clucknorris.app${urlFor(lang, slug)}"/>
${hreflangs(slug, langs)}
<link rel="icon" href="/cluck-norris-mascot.jpg"/>
<link rel="stylesheet" href="/theme.css"/>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Chakra+Petch:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${SHARED_CSS}${glow ? `:root{--glow:${glow}}` : ""}</style></head><body><div class="wrap">`;

const footer = (t) => `<div class="disclaimer">${esc(t.disclaimer)}</div>
<div class="footer-tag">🐔 <a href="https://clucknorris.app">clucknorris.app</a> — SCHOOL OF CRYPTO HARD KNOCKS</div>
</div></body></html>`;

function badgeGradient(g) {
  const [a, b] = Array.isArray(g) && g.length >= 2 ? g : ["#FFB627", "#FF7A18"];
  return `linear-gradient(135deg,${esc(a)},${esc(b)})`;
}
function glowFrom(g) {
  const a = Array.isArray(g) && g[0] ? g[0] : "#FFB627";
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(a).replace("#", "").padStart(6, "0").slice(0, 6));
  if (!m) return "rgba(255,182,39,0.18)";
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},0.18)`;
}

function bullets(arr) {
  return `<ul>${(arr || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
}
function paras(arr) {
  return (arr || []).map((p) => `<p>${esc(p)}</p>`).join("");
}

function renderAssetPage(a, lang, langs) {
  lang = L[lang] ? lang : "en";
  langs = langs && langs.length ? langs : ["en"];
  const t = L[lang];
  const facts = (a.quickFacts || []).map(
    (row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td></tr>`
  ).join("");
  const timeline = (a.history || []).map(
    (h) => `<li><span class="yr">${esc(h.year)}</span>${esc(h.event)}</li>`
  ).join("");
  const relChips = (a._related || []).map(
    (r) => `<a class="chip" href="${urlFor(lang, r.slug)}">${esc(r.name)} (${esc(r.ticker)})</a>`
  ).join("") + `<a class="chip" href="${urlFor(lang, null)}">${esc(t.allChains)}</a>`;

  return HEAD(lang, t.title(a.name, a.ticker), t.desc(a.name, a.ticker), t.og(a.name, a.ticker), t.ogDesc(a.name), glowFrom(a.gradient), a.slug, langs) + `
  <div class="hero">
    <div class="brand-mini">🐔 <a href="${urlFor(lang, null)}">CLUCK NORRIS — CRYPTO SCHOOL</a></div>
    <div class="hero-row">
      <div class="coin-badge" style="background:${badgeGradient(a.gradient)}">${esc(a.ticker)}</div>
      <div><h1>${esc(a.name)}</h1><div class="ticker">${esc(a.ticker)} · ${esc(a.category)}</div></div>
    </div>
    <p class="tagline">${esc(a.tagline)}</p>
    ${langSwitcher(lang, a.slug, langs)}
  </div>

  <div class="price-strip">
    <div class="price-box"><div class="lbl">${esc(t.price)}</div><div class="val" id="pxPrice">—</div></div>
    <div class="price-box"><div class="lbl">${esc(t.change)}</div><div class="val" id="pxChange">—</div></div>
    <div class="price-box"><div class="lbl">${esc(t.mcap)}</div><div class="val" id="pxMcap">—</div></div>
  </div>

  <div class="card"><h2>${esc(t.whatIs(a.name))}</h2>${paras(a.whatIsIt)}</div>
  <div class="card"><h2>${esc(t.how)}</h2>${paras(a.howItWorks && a.howItWorks.paragraphs)}${bullets(a.howItWorks && a.howItWorks.bullets)}</div>
  <div class="card"><h2>${esc(t.building)}</h2>${paras(a.building && a.building.paragraphs)}${bullets(a.building && a.building.bullets)}</div>
  <div class="card"><h2>${esc(t.facts)}</h2><table class="facts">${facts}</table></div>
  <div class="card"><h2>${esc(t.eco)}</h2>${bullets(a.ecosystem)}</div>
  ${timeline ? `<div class="card"><h2>${esc(t.history)}</h2><ul class="timeline">${timeline}</ul></div>` : ""}
  <div class="risk"><h2>${esc(t.risks)}</h2>${bullets(a.risks)}</div>
  <div class="card"><h2>${esc(t.invest)}</h2>${bullets(a.howToInvest)}</div>

  <div class="ask">
    <h2>🐔 ${esc(t.askTitle(a.name))}</h2>
    <div class="sub">${esc(t.askSub)}</div>
    <div class="ask-sugg">
      <button type="button" data-q="${esc(t.suggQ1(a.name))}">${esc(t.sugg1)}</button>
      <button type="button" data-q="${esc(t.suggQ2(a.name))}">${esc(t.sugg2)}</button>
      <button type="button" data-q="${esc(t.suggQ3(a.name))}">${esc(t.sugg3)}</button>
    </div>
    <form class="ask-form" id="askForm" autocomplete="off">
      <input id="askInput" type="text" maxlength="500" placeholder="${esc(t.askPlaceholder(a.name))}"/>
      <button type="submit" id="askBtn">${esc(t.askBtn)}</button>
    </form>
    <div class="ask-ans" id="askAns"><div class="who">CLUCK NORRIS</div><div id="askAnsText"></div></div>
  </div>

  <div class="cta">
    <h2>${esc(t.ctaTitle)}</h2>
    <p>${esc(t.ctaBody(a.name))}</p>
    <div class="btn-row"><a class="btn" href="/">${esc(t.ctaSchool)}</a><a class="btn ghost" href="/tools">${esc(t.ctaTools)}</a></div>
    <div class="chips">${relChips}</div>
  </div>

  <script>
  (async function(){
    try{
      const r=await fetch('/api/asset-price?id=${encodeURIComponent(a.coingeckoId)}');
      const d=await r.json(); if(!d||d.price==null)return;
      const fmt=n=>n>=1e9?'$'+(n/1e9).toFixed(1)+'B':n>=1e6?'$'+(n/1e6).toFixed(1)+'M':'$'+Number(n).toLocaleString();
      document.getElementById('pxPrice').textContent='$'+Number(d.price).toLocaleString(undefined,{maximumFractionDigits:d.price<1?6:2});
      var ce=document.getElementById('pxChange'); var c=Number(d.change24h||0);
      ce.textContent=(c>=0?'+':'')+c.toFixed(2)+'%'; ce.className='val '+(c>=0?'green':'red');
      document.getElementById('pxMcap').textContent=d.mcap?fmt(d.mcap):'—';
    }catch(e){}
  })();

  (function(){
    var NAME=${JSON.stringify(a.name)}, TICK=${JSON.stringify(a.ticker)}, LANG=${JSON.stringify(lang)};
    var THINKING=${JSON.stringify(L[lang].thinking)}, DOWN=${JSON.stringify(L[lang].commsDown)}, ASKLBL=${JSON.stringify(L[lang].askBtn)};
    var form=document.getElementById('askForm'), input=document.getElementById('askInput'),
        btn=document.getElementById('askBtn'), ans=document.getElementById('askAns'), ansT=document.getElementById('askAnsText');
    var busy=false;
    function ask(q){
      if(busy||!q||q.length<3)return; busy=true; btn.disabled=true; btn.textContent='…';
      ans.classList.add('show'); ansT.textContent=THINKING;
      fetch('/api/ask-cluck',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({question:'Regarding '+NAME+' ('+TICK+'): '+q, context:NAME+' ('+TICK+') learn page', lang:LANG})})
        .then(function(r){return r.json();})
        .then(function(j){ansT.textContent=(j&&j.success&&j.answer)?j.answer:((j&&j.error)||DOWN);})
        .catch(function(){ansT.textContent=DOWN;})
        .finally(function(){busy=false;btn.disabled=false;btn.textContent=ASKLBL;});
    }
    form.addEventListener('submit',function(e){e.preventDefault();var q=input.value.trim();if(q){input.value='';ask(q);}});
    Array.prototype.forEach.call(document.querySelectorAll('.ask-sugg button'),function(b){
      b.addEventListener('click',function(){var q=b.getAttribute('data-q');input.value=q;ask(q);});
    });
  })();
  </script>` + footer(t);
}

function renderHub(assets, lang, langs) {
  lang = L[lang] ? lang : "en";
  langs = langs && langs.length ? langs : ["en"];
  const t = L[lang];
  const cards = assets.map((a) => `<a class="hub-card" href="${urlFor(lang, a.slug)}">
    <div class="b" style="background:${badgeGradient(a.gradient)}">${esc(a.ticker)}</div>
    <div><div class="n">${esc(a.name)}</div><div class="t">${esc(a.ticker)}</div></div></a>`).join("");
  return HEAD(lang, t.hubTitle, t.hubDesc, t.hubH1, t.hubDesc, null, null, langs) + `
  <div class="hero">
    <div class="brand-mini">🐔 CLUCK NORRIS — SCHOOL OF CRYPTO HARD KNOCKS</div>
    <h1 style="font-family:var(--head);font-size:34px;letter-spacing:2px;margin-top:6px;">${esc(t.hubH1)}</h1>
    <p class="tagline">${esc(t.hubTagline)}</p>
    ${langSwitcher(lang, null, langs)}
  </div>
  <div class="card"><h2>${esc(t.hubPick)}</h2><div class="hub-grid">${cards}</div></div>
  <div class="cta"><h2>${esc(t.hubCtaTitle)}</h2><p>${esc(t.hubCtaBody)}</p>
    <div class="btn-row"><a class="btn" href="/">${esc(t.ctaSchool)}</a><a class="btn ghost" href="/tools">${esc(t.ctaTools)}</a></div></div>` + footer(t);
}

module.exports = { renderAssetPage, renderHub, esc, LEARN_LANGS };
