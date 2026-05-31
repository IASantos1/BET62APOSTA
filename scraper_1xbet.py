import asyncio
import random
import json
import time
from datetime import datetime
import httpx
from playwright.async_api import async_playwright
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')

CHROMIUM_PATH = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium"

class FreeProxy1xBetScraper:
    def __init__(self):
        self.proxies = []
        self.working_proxies = []
        self.current_proxy_index = 0

    async def fetch_free_proxies(self):
        """Busca proxies gratuitos de várias fontes"""
        urls = [
            "https://api.proxyscrape.com/v4/free-proxy-list/get?protocol=http&timeout=10000&country=all&anonymity=all&simplified=true",
            "https://www.proxy-list.download/api/v1/get?type=http",
            "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt",
        ]
        
        print("🔍 Buscando proxies gratuitos...")
        async with httpx.AsyncClient(timeout=15) as client:
            for url in urls:
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200:
                        lines = resp.text.strip().split('\n')
                        for line in lines:
                            if ':' in line:
                                proxy = f"http://{line.strip()}"
                                if proxy not in self.proxies:
                                    self.proxies.append(proxy)
                except:
                    continue
        
        print(f"📊 Encontrados {len(self.proxies)} proxies gratuitos")

    async def validate_proxy(self, proxy):
        """Testa se o proxy funciona"""
        try:
            async with httpx.AsyncClient(proxies={"all://": proxy}, timeout=8) as client:
                resp = await client.get("https://httpbin.org/ip")
                return resp.status_code == 200
        except:
            return False

    async def validate_all_proxies(self):
        """Valida os proxies (pode demorar)"""
        print("🔥 Validando proxies (pode levar alguns minutos)...")
        tasks = [self.validate_proxy(p) for p in self.proxies[:150]]
        results = await asyncio.gather(*tasks)
        
        self.working_proxies = [p for p, ok in zip(self.proxies[:150], results) if ok]
        print(f"✅ {len(self.working_proxies)} proxies funcionando")

    def get_next_proxy(self):
        if not self.working_proxies:
            return None
        proxy = self.working_proxies[self.current_proxy_index % len(self.working_proxies)]
        self.current_proxy_index += 1
        return {"server": proxy}

    async def scrape_live_odds(self, url: str = "https://1xbet.com/en/live"):
        async with async_playwright() as p:
            proxy = self.get_next_proxy()
            
            browser = await p.chromium.launch(
                headless=True,
                executable_path=CHROMIUM_PATH,
                proxy=proxy,
                args=[
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                ]
            )

            context = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
            )

            page = await context.new_page()

            try:
                print(f"🌐 Acessando Live Odds com proxy: {proxy['server'] if proxy else 'None'}")
                await page.goto(url, wait_until="domcontentloaded", timeout=60000)
                
                await asyncio.sleep(random.uniform(4, 7))
                await page.evaluate("window.scrollBy(0, 600)")
                await asyncio.sleep(2)

                data = await page.evaluate("""() => {
                    const events = Array.from(document.querySelectorAll('.live-event, .c-events__item')).slice(0, 20);
                    return events.map(event => {
                        const title = event.querySelector('.c-events__name, .event-title')?.innerText || '';
                        const odds = Array.from(event.querySelectorAll('.bet-coeff, .c-bets__inner')).map(el => el.innerText.trim());
                        return { title: title.trim(), odds: odds };
                    });
                }""")

                result = {
                    "timestamp": datetime.now().isoformat(),
                    "total_events": len(data),
                    "events": data
                }

                filename = f"1xbet_live_odds_{int(time.time())}.json"
                with open(filename, "w", encoding="utf-8") as f:
                    json.dump(result, f, ensure_ascii=False, indent=2)

                print(f"✅ Sucesso! Extraídos {len(data)} eventos ao vivo → {filename}")
                return result

            except Exception as e:
                logging.error(f"Erro: {e}")
            finally:
                await browser.close()


async def main():
    scraper = FreeProxy1xBetScraper()
    
    await scraper.fetch_free_proxies()
    await scraper.validate_all_proxies()
    
    if not scraper.working_proxies:
        print("❌ Nenhum proxy gratuito funcionou. Tente novamente mais tarde.")
        return
    
    await scraper.scrape_live_odds()

asyncio.run(main())
