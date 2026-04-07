export default async function handler(req, res) {
    try {
        const page = await fetch("https://pzs2pszczyna.pl/");
        const html = await page.text();

        // 🔥 wyciągamy aktualności
        const items = [...html.matchAll(/<h2 class="item-title".*?<\/p>/gs)];

        const news = items.slice(0, 5).map(item => {
            const block = item[0];

            const titleMatch = block.match(/<a[^>]*>(.*?)<\/a>/);
            const descMatch = block.match(/<p>(.*?)<\/p>/);

            const title = titleMatch ? titleMatch[1].trim() : "Brak tytułu";
            const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, "").trim() : "";

            return { title, desc };
        });

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.status(200).json(news);

    } catch (err) {
        res.status(500).json({ error: "Błąd pobierania aktualności" });
    }
}