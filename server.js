const express = require("express");
const axios = require("axios");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(express.json());

// 🔥 CORS (ajuste depois com seu domínio Netlify)
app.use(cors({
    origin: "https://paninii.online"
}));

const PAYMENTS_FILE = "./payments.json";

// cria arquivo se não existir
if (!fs.existsSync(PAYMENTS_FILE)) {
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify([]));
}

// leitura segura
function readPayments() {
    try {
        const raw = fs.readFileSync(PAYMENTS_FILE, "utf8");
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

// salvar pagamento
function savePayment(payment) {
    try {
        const data = readPayments();
        data.push(payment);
        fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Erro ao salvar pagamento:", err.message);
    }
}

// validar documento
function isValidDocument(doc, type) {
    if (!doc) return false;

    const cleaned = doc.replace(/\D/g, "");

    if (type === "CPF") return cleaned.length === 11;
    if (type === "CNPJ") return cleaned.length === 14;

    return false;
}

// formatar telefone
function formatPhone(phone) {
    if (!phone) return "";
    const cleaned = phone.replace(/\D/g, "");
    return `+55${cleaned}`;
}

// headers Sunize
function getHeaders() {
    return {
        "x-api-key": process.env.SUNIZE_API_KEY,
        "x-api-secret": process.env.SUNIZE_API_SECRET,
        "Content-Type": "application/json"
    };
}

/* =========================
   🔥 CRIAR PIX
========================= */
app.post("/sunize/create", async (req, res) => {
    try {
        const { external_id, total_amount, payment_method, items, customer } = req.body;

        if (!external_id || !total_amount || !customer) {
            return res.status(400).json({ error: "external_id, total_amount e customer são obrigatórios" });
        }

        if (!customer.name || !customer.email || !customer.phone || !customer.document_type || !customer.document) {
            return res.status(400).json({ error: "Dados do cliente incompletos" });
        }

        if (!isValidDocument(customer.document, customer.document_type)) {
            return res.status(400).json({ error: "Documento inválido" });
        }

        const payload = {
            external_id,
            total_amount: Number(total_amount),
            payment_method: payment_method || "PIX",
            items: items?.length ? items : [{
                id: "1",
                title: "Produto",
                price: Number(total_amount),
                quantity: 1,
                is_physical: true
            }],
            ip: (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
    .split(",")[0]
    .replace("::ffff:", "")
    .trim(),
            customer: {
                name: customer.name,
                email: customer.email,
                phone: formatPhone(customer.phone),
                document_type: customer.document_type,
                document: customer.document.replace(/\D/g, "")
            }
        };

        const response = await axios.post(
            "https://api.sunize.com.br/v1/transactions",
            payload,
            {
                headers: getHeaders(),
                timeout: 15000
            }
        );

        const data = response.data;

        savePayment({
            id: data.id,
            external_id: data.external_id,
            status: data.status,
            amount: data.total_value,
            customer: payload.customer,
            pix: data.pix,
            created_at: new Date().toISOString()
        });

        return res.json({
            id: data.id,
            external_id: data.external_id,
            status: data.status,
            total_value: data.total_value,
            payment_method: data.payment_method,
            pix: data.pix,
            customer: data.customer
        });

    } catch (err) {
        console.error("Erro Sunize:", err.response?.data || err.message);

        return res.status(err.response?.status || 500).json({
            error: err.response?.data?.message || "Erro ao criar pagamento",
            details: err.response?.data || null
        });
    }
});

/* =========================
   🔎 CONSULTAR PIX
========================= */
app.get("/sunize/transaction/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const response = await axios.get(
            `https://api.sunize.com.br/v1/transactions/${id}`,
            { headers: getHeaders() }
        );

        return res.json(response.data);

    } catch (err) {
        console.error("Erro consulta:", err.response?.data || err.message);

        return res.status(500).json({
            error: "Erro ao consultar transação"
        });
    }
});

/* =========================
   📦 PAGAMENTOS LOCAIS
========================= */
app.get("/payments", (req, res) => {
    return res.json(readPayments());
});

/* =========================
   💚 HEALTH CHECK
========================= */
app.get("/health", (req, res) => {
    res.json({ status: "OK", time: new Date().toISOString() });
});

/* =========================
   🚀 START SERVER (RENDER)
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
