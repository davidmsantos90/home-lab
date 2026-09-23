import pathlib
import tempfile
import unittest

import update_foods_pt_pt as updater


class FoodUpdaterTests(unittest.TestCase):
    def test_normalize_ignores_case_accents_and_spacing(self):
        self.assertEqual(updater.normalize("  PÃO   DE — LÓ "), "pao de - lo")

    def test_load_env_file_supports_quotes_and_comments(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / ".env"
            path.write_text("# comment\nAPI_TOKEN='secret'\nBASE_URL = \"https://example.test\"\n", encoding="utf-8")
            self.assertEqual(
                updater.load_env_file(path),
                {"API_TOKEN": "secret", "BASE_URL": "https://example.test"},
            )

    def test_match_catalog_food_prefers_singular_name_over_shared_plural(self):
        octopus = {"id": "1", "name": "octopus", "pluralName": "octopi"}
        typo = {"id": "2", "name": "octopuse", "pluralName": "octopi"}
        index = updater.build_name_index([octopus, typo])
        matched = updater.match_catalog_food(
            index,
            {"name": "octopus", "plural_name": "octopi"},
            {"name": "octopus", "plural_name": "octopi"},
        )
        self.assertEqual(matched, octopus)

    def test_translation_uses_override_for_untranslated_upstream_entry(self):
        translated = updater.translation_for(
            "ground beef",
            {"name": "ground beef", "plural_name": "ground beef", "aliases": []},
            {},
        )
        self.assertEqual(translated, ["carne de vaca picada"])

    def test_expected_unmatched_entries_have_custom_foods(self):
        custom_aliases = {
            alias
            for _, _, _, aliases in updater.CUSTOM_FOODS
            for alias in aliases
        }
        self.assertTrue(updater.EXPECTED_UNMATCHED_CATALOG_KEYS <= custom_aliases)

    def test_update_food_preserves_editable_fields(self):
        calls = []
        client = updater.MealieClient("https://example.test", "token")
        client.request = lambda method, path, payload=None: calls.append((method, path, payload))
        food = {
            "id": "food-id",
            "name": "rice",
            "pluralName": "rices",
            "description": "description",
            "extras": {"source": "seed"},
            "labelId": "label-id",
            "aliases": [],
            "substitutions": [{"substituteFoodId": "other-id", "note": "note"}],
            "householdsWithIngredientFood": ["household-id"],
        }

        client.update_food(food, ["arroz"])

        method, path, payload = calls[0]
        self.assertEqual((method, path), ("PUT", "/api/foods/food-id"))
        self.assertEqual(payload["aliases"], [{"name": "arroz"}])
        self.assertEqual(payload["substitutions"], food["substitutions"])
        self.assertEqual(payload["householdsWithIngredientFood"], ["household-id"])


if __name__ == "__main__":
    unittest.main()
