#!/usr/bin/env python3
"""Add PT-PT food aliases and Portuguese staples to a Mealie group.

The operation is idempotent. Existing foods are updated in place so recipe and
shopping-list references keep their UUIDs. By default this is a dry run; pass
--apply to write changes.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import pathlib
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MEALIE_VERSION = "v3.27.0"
FOOD_LOCALE_URL = (
    "https://raw.githubusercontent.com/mealie-recipes/mealie/"
    f"{MEALIE_VERSION}/mealie/repos/seed/resources/foods/locales/{{locale}}.json"
)
TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"
DEFAULT_CACHE_PATH = SCRIPT_DIR / ".food-translations-pt-PT.json"
EXPECTED_UNMATCHED_CATALOG_KEYS = {
    "chestnut purée",
    "italian bread crumb",
    "textured vegetable protein",
}

# Corrections for machine translations that are ambiguous, Brazilian, or not
# culinary terms. These also keep aliases unique where two English foods would
# otherwise receive the same Portuguese alias.
TRANSLATION_OVERRIDES = {
    "all-purpose flour": "farinha de trigo sem fermento",
    "almond meal": "amêndoa moída",
    "bay scallop": "vieira-da-baía",
    "beef short rib": "costela curta de vaca",
    "beef stock": "fundo de carne",
    "beetroot juice": "sumo de beterraba-roxa",
    "biscuit": "pãozinho americano",
    "biscuit dough": "massa de bolacha",
    "bluefish": "anchova-azul",
    "boysenberry": "amora-boysen",
    "bratwurst": "salsicha bratwurst",
    "candy corn": "rebuçado de milho",
    "canned kidney bean": "feijão-vermelho enlatado",
    "canned pea": "ervilha verde enlatada",
    "candied ginger": "gengibre confitado",
    "cayenne": "caiena",
    "cheeto": "snack de queijo",
    "chicken leg": "perna de frango",
    "chicken stock": "fundo de galinha",
    "chili paste": "pasta de malagueta",
    "chive": "cebolinho-francês",
    "chocolate chip cookie": "bolacha com pepitas de chocolate",
    "chocolate syrup": "xarope de chocolate",
    "cilantro": "folhas de coentros",
    "cloudberry": "amora-ártica",
    "cognac": "aguardente de Cognac",
    "confectioners sugar": "açúcar em pó",
    "cookie": "bolacha americana",
    "corn dog": "salsicha panada no palito",
    "corn flour": "farinha fina de milho",
    "cornstarch": "fécula de milho",
    "crawfish": "lagostim-de-rio",
    "cream of coconut": "natas de coco",
    "cream of rice": "papa de arroz",
    "dewberry": "amora-de-orvalho",
    "dried prawn": "gamba seca",
    "field pea": "ervilha de campo",
    "finger millet": "milheto-dedo",
    "finger millet flour": "farinha de milho-miúdo",
    "flounder": "solha",
    "fudge": "fudge de chocolate",
    "gilt-head bream": "dourada-real",
    "gooseberry": "groselha-espinhosa",
    "ground beef": "carne de vaca picada",
    "ground chicken": "carne de frango picada",
    "ground pork": "carne de porco picada",
    "ground turkey": "carne de peru picada",
    "ground venison": "carne de veado picada",
    "grouper": "cherne",
    "grünkern": "espelta verde",
    "halibut": "alabote",
    "heavy cream": "natas para bater",
    "huckleberry": "mirtilo-americano",
    "jaggery": "açúcar jaggery",
    "jam": "compota",
    "jello": "gelatina aromatizada",
    "kidney bean": "feijão-vermelho",
    "lamb shank": "chambão de borrego",
    "lamb stock": "fundo de borrego",
    "langoustine": "lagostim-do-norte",
    "lemon curd": "creme de limão",
    "lime": "lima",
    "lime extract": "extrato de lima",
    "lime juice": "sumo de lima",
    "lime peel": "casca de lima",
    "lime soda": "refrigerante de lima",
    "lime zest": "raspa de lima",
    "lingonberry": "airela-vermelha",
    "mace": "macis",
    "milk cream": "nata de leite",
    "millet flour": "farinha de painço",
    "mincemeat": "recheio de frutos secos e especiarias",
    "mullet": "tainha",
    "non-dairy cream": "natas vegetais",
    "noodle": "massa asiática",
    "palmini": "massa de palmito",
    "picante sauce": "molho picante de estilo mexicano",
    "pickled pepper": "pimento em conserva",
    "pizza crust": "base de pizza",
    "plaice": "solha-europeia",
    "pomfret": "peixe-pomfret",
    "pork and bean": "feijão com carne de porco",
    "pork broth": "caldo líquido de porco",
    "pork cutlet": "escalope de porco",
    "pork spare rib": "entrecosto de porco",
    "powdered sugar": "açúcar em pó",
    "prawn": "gamba",
    "prosciutto": "presunto italiano",
    "pure lime extract": "extrato puro de lima",
    "queso dip": "creme de queijo",
    "roast beef": "rosbife",
    "rotisserie chicken": "frango de churrasco",
    "rusk": "tosta seca",
    "salt herring": "arenque em salmoura",
    "scarlet runner bean": "feijão-de-sete-anos",
    "scampi": "camarão scampi",
    "sesame dressing": "vinagrete de sésamo",
    "sherbet": "gelado de fruta",
    "skyr": "skyr",
    "snap pea": "ervilha-torta",
    "snow pea": "ervilha-de-neve",
    "sorbet": "sorvete de fruta",
    "sour cream": "natas ácidas",
    "sugarcane vinegar": "vinagre de cana-de-açúcar",
    "swordfish": "espadarte",
    "tater tot": "croquete de batata",
    "thc": "tetraidrocanabinol",
    "tomato bisque": "creme aveludado de tomate",
    "tomato relish": "condimento de tomate",
    "treacle": "melaço claro",
    "turkey stock": "fundo de peru",
    "veal broth": "caldo claro de vitela",
    "veal cutlet": "escalope de vitela",
    "walnut milk": "bebida de noz",
    "whipped cream": "natas batidas",
    "whipping cream": "natas para bater",
    "whole-wheat pastry flour": "farinha integral para pastelaria",
}

PT_PT_REPLACEMENTS = (
    ("suco", "sumo"),
    ("brócolis", "brócolos"),
    ("abobrinha", "curgete"),
    ("berinjela", "beringela"),
    ("cebolinha", "cebolinho"),
    ("pimentão", "pimento"),
    ("creme de leite", "natas"),
    ("carne moída", "carne picada"),
    ("sorvete", "gelado"),
)

# Foods not represented by Mealie's v3.27 seed catalogue. Labels are resolved
# by name from existing seeded foods; UUIDs are never hard-coded.
CUSTOM_FOODS = (
    ("água", "águas", "Beverages", ("water",)),
    ("água com gás", "águas com gás", "Beverages", ("água gaseificada", "sparkling water")),
    ("massa", "massas", "Grains & Cereals", ("pasta",)),
    ("farinha de trigo", "farinhas de trigo", "Baking", ("farinha de trigo branca",)),
    ("atum", "atuns", "Fish", ("tuna",)),
    ("carne de porco", "carnes de porco", "Meats", ("porco",)),
    ("carne de vaca", "carnes de vaca", "Meats", ("carne bovina",)),
    ("frango", "frangos", "Meats", ("galinha",)),
    ("peru", "perus", "Meats", ()),
    ("linguiça", "linguiças", "Meats", ()),
    ("presunto", "presuntos", "Meats", ("presunto curado",)),
    ("feijão", "feijões", "Legumes", ()),
    ("couve portuguesa", "couves portuguesas", "Vegetables & Greens", ("couve-penca",)),
    ("piri-piri", "piri-piris", "Herbs & Spices", ("piripíri",)),
    ("mel", "méis", "Sugar & Sweeteners", ()),
    ("sal", "sais", "Herbs & Spices", ("sal de cozinha",)),
    ("pimenta-preta", "pimentas-pretas", "Herbs & Spices", ("pimenta preta",)),
    ("broa", "broas", "Bread & Salty Snackssta", ("broa de milho",)),
    ("alheira", "alheiras", "Meats", ()),
    ("farinheira", "farinheiras", "Meats", ()),
    ("morcela", "morcelas", "Meats", ("morcela de sangue",)),
    ("queijo da Serra", "queijos da Serra", "Cheese", ("queijo Serra da Estrela",)),
    ("queijo de São Jorge", "queijos de São Jorge", "Cheese", ("queijo São Jorge",)),
    ("carapau", "carapaus", "Fish", ("chicharro", "horse mackerel")),
    (
        "peixe-espada-preto",
        "peixes-espada-pretos",
        "Fish",
        ("peixe-espada", "black scabbardfish"),
    ),
    ("corvina", "corvinas", "Fish", ("croaker",)),
    ("raia", "raias", "Fish", ("skate",)),
    ("faneca", "fanecas", "Fish", ("pouting",)),
    ("sargo", "sargos", "Fish", ()),
    ("besugo", "besugos", "Fish", ()),
    ("berbigão", "berbigões", "Seafood & Seaweed", ("cockle",)),
    ("navalheira", "navalheiras", "Seafood & Seaweed", ("velvet crab",)),
    ("lavagante", "lavagantes", "Seafood & Seaweed", ("European lobster",)),
    ("sapateira", "sapateiras", "Seafood & Seaweed", ("brown crab",)),
    ("borrego", "borregos", "Meats", ("cordeiro", "lamb")),
    ("cabrito", "cabritos", "Meats", ("carne de cabrito",)),
    ("vitela", "vitelas", "Meats", ("veal",)),
    ("javali", "javalis", "Meats", ("wild boar",)),
    ("costeleta de porco", "costeletas de porco", "Meats", ("pork chop",)),
    ("paio", "paios", "Meats", ()),
    ("salpicão", "salpicões", "Meats", ()),
    ("couve-lombarda", "couves-lombardas", "Vegetables & Greens", ("couve lombarda", "savoy cabbage")),
    ("couve-coração", "couves-coração", "Vegetables & Greens", ("couve coração", "pointed cabbage")),
    ("nabiça", "nabiças", "Vegetables & Greens", ("turnip greens",)),
    ("cogumelo", "cogumelos", "Mushrooms", ("mushroom",)),
    ("feijão-frade", "feijões-frade", "Legumes", ("feijão frade", "black-eyed pea")),
    ("tremoço", "tremoços", "Legumes", ("lupin bean",)),
    ("pimento verde", "pimentos verdes", "Vegetables & Greens", ("green bell pepper",)),
    ("pimento vermelho", "pimentos vermelhos", "Vegetables & Greens", ("red bell pepper",)),
    ("puré de castanha", "purés de castanha", "Nuts & Seeds", ("chestnut purée",)),
    (
        "proteína vegetal texturizada",
        "proteínas vegetais texturizadas",
        "Dairy-Free & Meat Substitutes",
        ("textured vegetable protein", "PVT"),
    ),
    (
        "pão ralado italiano",
        "pães ralados italianos",
        "Bread & Salty Snacks",
        ("italian bread crumb",),
    ),
)


def normalize(value: str | None) -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(character for character in text if unicodedata.category(character) != "Mn")
    return " ".join(text.lower().replace("–", "-").replace("—", "-").split())


def load_env_file(path: pathlib.Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def setting(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name) or load_env_file(SCRIPT_DIR / ".env").get(name) or default


def request_json(
    url: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    token: str | None = None,
    timeout: int = 60,
) -> Any:
    headers = {"Accept": "application/json"}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed ({exc.code}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{method} {url} failed: {exc.reason}") from exc
    return json.loads(raw) if raw else None


class MealieClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        return request_json(f"{self.base_url}{path}", method, payload, self.token)

    def foods(self) -> list[dict[str, Any]]:
        foods: list[dict[str, Any]] = []
        page = 1
        while True:
            result = self.request("GET", f"/api/foods?page={page}&perPage=1000&orderBy=name&orderDirection=asc")
            if not isinstance(result, dict) or not isinstance(result.get("items"), list):
                raise RuntimeError("Mealie returned an unexpected food-list response")
            foods.extend(result["items"])
            if page >= result.get("total_pages", 1):
                return foods
            page += 1

    def seed_foods(self) -> None:
        self.request("POST", "/api/groups/seeders/foods", {"locale": "pt-PT"})

    def update_food(self, food: dict[str, Any], aliases: list[str]) -> None:
        body = {
            "id": food["id"],
            "name": food["name"],
            "pluralName": food.get("pluralName"),
            "description": food.get("description") or "",
            "extras": food.get("extras") or {},
            "labelId": food.get("labelId"),
            "aliases": [{"name": name} for name in aliases],
            "substitutions": [
                {
                    "substituteFoodId": item.get("substituteFoodId"),
                    "note": item.get("note"),
                }
                for item in food.get("substitutions") or []
            ],
            "householdsWithIngredientFood": food.get("householdsWithIngredientFood") or [],
        }
        self.request("PUT", f"/api/foods/{food['id']}", body)

    def create_food(
        self,
        name: str,
        plural_name: str,
        label_id: str,
        aliases: tuple[str, ...],
    ) -> None:
        self.request(
            "POST",
            "/api/foods",
            {
                "name": name,
                "pluralName": plural_name,
                "description": "",
                "extras": {},
                "labelId": label_id,
                "aliases": [{"name": alias} for alias in aliases],
                "substitutions": [],
                "householdsWithIngredientFood": [],
            },
        )


def flatten_catalog(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    foods: list[dict[str, Any]] = []
    for section in catalog.values():
        foods.extend({"key": key, **value} for key, value in section.get("foods", {}).items())
    return foods


def food_terms(food: dict[str, Any]) -> list[str]:
    return [
        food.get("name") or "",
        food.get("pluralName") or "",
        *(alias["name"] for alias in food.get("aliases") or []),
    ]


def editable_aliases(food: dict[str, Any]) -> list[str]:
    return [alias["name"] for alias in food.get("aliases") or []]


def normalize_pt_pt(text: str) -> str:
    result = text.strip()
    for source, replacement in PT_PT_REPLACEMENTS:
        result = result.replace(source, replacement).replace(source.capitalize(), replacement.capitalize())
    return result


def load_cache(path: pathlib.Path) -> dict[str, str]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in data.items()):
        raise RuntimeError(f"Translation cache must be a string map: {path}")
    return data


def save_cache(path: pathlib.Path, cache: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def translate_one(text: str) -> str:
    query = urllib.parse.urlencode(
        {
            "client": "gtx",
            "sl": "en",
            "tl": "pt",
            "dt": "t",
            "q": text,
        }
    )
    last_error: RuntimeError | None = None
    for attempt in range(3):
        try:
            result = request_json(f"{TRANSLATE_URL}?{query}")
            translated = "".join(part[0] for part in result[0] if part and part[0]).strip()
            if not translated:
                raise RuntimeError(f"Translation service returned an empty result for {text!r}")
            return normalize_pt_pt(translated)
        except RuntimeError as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2**attempt)
    raise RuntimeError(f"Could not translate {text!r}: {last_error}")


def translate_missing(
    texts: set[str],
    cache: dict[str, str],
    workers: int,
    cache_path: pathlib.Path,
) -> None:
    missing = sorted(text for text in texts if text not in cache and text not in TRANSLATION_OVERRIDES)
    if not missing:
        return
    print(f"Translating {len(missing)} upstream PT-PT gaps...")
    failures: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(translate_one, text): text for text in missing}
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            text = futures[future]
            try:
                cache[text] = future.result()
            except RuntimeError as exc:
                failures.append(str(exc))
            completed += 1
            if completed % 100 == 0 or completed == len(missing):
                save_cache(cache_path, cache)
                print(f"  translated {completed}/{len(missing)}")
    if failures:
        raise RuntimeError(
            f"{len(failures)} translations failed; successful results were cached. "
            f"First failure: {failures[0]}"
        )


def translation_for(source: str, pt_entry: dict[str, Any], cache: dict[str, str]) -> list[str]:
    translated = [
        pt_entry.get("name") or "",
        pt_entry.get("plural_name") or "",
        *(pt_entry.get("aliases") or []),
    ]
    source_terms = {normalize(source)}
    translated_terms = {normalize(value) for value in translated if value}
    if not translated_terms - source_terms:
        translated = [TRANSLATION_OVERRIDES.get(source) or cache[source]]
    elif source in TRANSLATION_OVERRIDES:
        translated.insert(0, TRANSLATION_OVERRIDES[source])
    return list(dict.fromkeys(normalize_pt_pt(value) for value in translated if value))


def build_name_index(foods: list[dict[str, Any]], include_aliases: bool = False) -> dict[str, list[dict[str, Any]]]:
    index: dict[str, list[dict[str, Any]]] = {}
    for food in foods:
        terms = food_terms(food) if include_aliases else [food.get("name") or "", food.get("pluralName") or ""]
        for value in terms:
            key = normalize(value)
            if key:
                index.setdefault(key, []).append(food)
    return index


def unique_food(index: dict[str, list[dict[str, Any]]], terms: list[str]) -> dict[str, Any] | None:
    candidates: dict[str, dict[str, Any]] = {}
    for term in terms:
        for food in index.get(normalize(term), []):
            candidates[food["id"]] = food
    if len(candidates) == 1:
        return next(iter(candidates.values()))
    return None


def match_catalog_food(
    index: dict[str, list[dict[str, Any]]],
    en_entry: dict[str, Any],
    pt_entry: dict[str, Any],
) -> dict[str, Any] | None:
    # Prefer exact singular names. Plurals such as "octopi" may legitimately
    # belong to more than one seeded record.
    for terms in (
        [en_entry.get("name") or ""],
        [pt_entry.get("name") or ""],
        [en_entry.get("plural_name") or "", pt_entry.get("plural_name") or ""],
    ):
        food = unique_food(index, terms)
        if food:
            return food
    return None


def run(args: argparse.Namespace) -> int:
    token = setting("API_TOKEN")
    base_url = setting("BASE_URL")
    if not token:
        raise RuntimeError("API_TOKEN is required in the environment or mealie/.env")
    if not base_url:
        raise RuntimeError("BASE_URL is required in the environment or mealie/.env")

    client = MealieClient(base_url, token)
    foods = client.foods()
    if not foods:
        if not args.apply:
            print("The group has no foods. --apply would seed the pt-PT catalogue first.")
            return 0
        print("The group has no foods; seeding Mealie's pt-PT catalogue...")
        client.seed_foods()
        foods = client.foods()

    en_catalog = flatten_catalog(request_json(FOOD_LOCALE_URL.format(locale="en-US")))
    pt_catalog = {
        entry["key"]: entry
        for entry in flatten_catalog(request_json(FOOD_LOCALE_URL.format(locale="pt-PT")))
    }
    cache = load_cache(args.cache)

    name_index = build_name_index(foods)
    mapped: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    translation_sources: set[str] = set()
    unmatched: list[str] = []
    for en_entry in en_catalog:
        pt_entry = pt_catalog.get(en_entry["key"])
        if not pt_entry:
            continue
        food = match_catalog_food(name_index, en_entry, pt_entry)
        if not food:
            unmatched.append(en_entry["key"])
            continue
        mapped.append((food, en_entry, pt_entry))
        pt_values = {normalize(pt_entry.get("name")), normalize(pt_entry.get("plural_name"))}
        en_values = {
            normalize(en_entry["key"]),
            normalize(en_entry.get("name")),
            normalize(en_entry.get("plural_name")),
        }
        if not pt_values - en_values:
            translation_sources.add(en_entry["name"])

    translate_missing(translation_sources, cache, args.workers, args.cache)
    save_cache(args.cache, cache)

    occupied: dict[str, str] = {}
    for food in foods:
        for term in food_terms(food):
            if normalize(term):
                occupied[normalize(term)] = food["id"]

    updates: list[tuple[dict[str, Any], list[str]]] = []
    collisions: list[str] = []
    for food, en_entry, pt_entry in mapped:
        existing = editable_aliases(food)
        seen = {normalize(value) for value in food_terms(food)}
        additions: list[str] = []
        for alias in translation_for(en_entry["name"], pt_entry, cache):
            key = normalize(alias)
            if not key or key in seen or key in {
                normalize(en_entry["name"]),
                normalize(en_entry.get("plural_name")),
            }:
                continue
            owner = occupied.get(key)
            if owner and owner != food["id"]:
                collisions.append(f"{en_entry['name']!r} -> {alias!r}")
                continue
            additions.append(alias)
            seen.add(key)
            occupied[key] = food["id"]
        if additions:
            updates.append((food, existing + additions))

    label_ids = {
        food["label"]["name"]: food["labelId"]
        for food in foods
        if food.get("label") and food.get("labelId")
    }
    represented = build_name_index(foods, include_aliases=True)
    creations: list[tuple[str, str, str, tuple[str, ...]]] = []
    for name, plural_name, label_name, aliases in CUSTOM_FOODS:
        if any(represented.get(normalize(term)) for term in (name, plural_name, *aliases)):
            continue
        if label_name not in label_ids:
            raise RuntimeError(f"Cannot create {name!r}: Mealie label {label_name!r} was not found")
        safe_aliases = tuple(alias for alias in aliases if normalize(alias) not in occupied)
        creations.append((name, plural_name, label_ids[label_name], safe_aliases))
        occupied[normalize(name)] = f"new:{name}"
        for alias in safe_aliases:
            occupied[normalize(alias)] = f"new:{name}"

    malformed_okra = next(
        (
            food
            for food in foods
            if not (food.get("name") or "").strip() and normalize(food.get("pluralName")) == "quiabo"
        ),
        None,
    )

    print(f"Mealie foods: {len(foods)}")
    print(f"Matched v3.27 catalogue entries: {len(mapped)}")
    print(f"Food updates: {len(updates)}")
    print(f"Portuguese foods to create: {len(creations)}")
    unexpected_unmatched = sorted(set(unmatched) - EXPECTED_UNMATCHED_CATALOG_KEYS)
    print(f"Expected unmatched catalogue entries: {len(unmatched) - len(unexpected_unmatched)}")
    print(f"Unexpected unmatched catalogue entries: {len(unexpected_unmatched)}")
    print(f"Skipped alias collisions: {len(collisions)}")
    if collisions:
        for collision in collisions[:20]:
            print(f"  collision: {collision}")
        if len(collisions) > 20:
            print(f"  ... and {len(collisions) - 20} more")

    if not args.apply:
        print("Dry run only. Re-run with --apply to update Mealie.")
        return 2 if collisions or unexpected_unmatched else 0

    if collisions or unexpected_unmatched:
        raise RuntimeError(
            "Refusing a partial update: "
            f"{len(collisions)} alias collisions and "
            f"{len(unexpected_unmatched)} unexpected unmatched catalogue entries"
        )

    if malformed_okra:
        malformed_okra["name"] = "quiabo"
        aliases = editable_aliases(malformed_okra)
        if "quiabos" not in aliases:
            aliases.append("quiabos")
        client.update_food(malformed_okra, aliases)
        print("Repaired malformed quiabo food")

    for index, (food, aliases) in enumerate(updates, start=1):
        client.update_food(food, aliases)
        if index % 100 == 0 or index == len(updates):
            print(f"Updated {index}/{len(updates)} foods")

    for name, plural_name, label_id, aliases in creations:
        client.create_food(name, plural_name, label_id, aliases)
        print(f"Created {name}")

    final_foods = client.foods()
    blank_names = [food["id"] for food in final_foods if not (food.get("name") or "").strip()]
    if blank_names:
        raise RuntimeError(f"Validation failed: {len(blank_names)} foods have blank names")
    print(
        "Done: "
        f"{len(final_foods)} foods, "
        f"{sum(1 for food in final_foods if food.get('aliases'))} with aliases, "
        f"{sum(len(food.get('aliases') or []) for food in final_foods)} aliases"
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Apply changes; the default is a dry run")
    parser.add_argument(
        "--cache",
        type=pathlib.Path,
        default=DEFAULT_CACHE_PATH,
        help=f"Machine-translation cache (default: {DEFAULT_CACHE_PATH})",
    )
    parser.add_argument("--workers", type=int, default=8, help="Concurrent translation requests (default: 8)")
    args = parser.parse_args()
    if args.workers < 1:
        parser.error("--workers must be at least 1")
    return args


def main() -> int:
    return run(parse_args())


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, json.JSONDecodeError) as exc:
        print(f"Food update failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
