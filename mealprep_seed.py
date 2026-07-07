"""Seed data for the Meal Prep module (data/mealprep.json).

Parker's 4-week meal prep cookbook: 4 themed weeks x 3 dishes x 6 servings
(~600 cal / ~60g protein per serving, 18 containers per prep:
12 fridge for days 1-4, 6 freezer for days 5-6, portioned on prep day).
Dish ids 1-12 are the four template weeks, 13-16 are substitutes;
new dishes added later must use max+1 over all dishes.
Shopping cats: meat | carbs | produce | dairy | pantry.
prep_slot drives the 5-step prep plan: oven | stovetop | simmer.
spice_rank orders stovetop dishes mildest-flavor-first.
"""

MEALPREP_DEFAULT = {
    "schema": 1,
    "rotation_idx": 0,
    "weeks": [],
    "templates": [
        {"id": "asian",     "label": "ASIAN",            "dish_ids": [1, 2, 3]},
        {"id": "texmex",    "label": "TEX-MEX",          "dish_ids": [4, 5, 6]},
        {"id": "comfort",   "label": "BURGER / COMFORT", "dish_ids": [7, 8, 9]},
        {"id": "pasta_med", "label": "PASTA + MED",      "dish_ids": [10, 11, 12]},
    ],
    "pantry": [
        {"id": i + 1, "text": t, "done": False} for i, t in enumerate([
            "Soy sauce (low sodium)", "Honey", "Rice vinegar", "Balsamic vinegar",
            "Sesame oil", "Gochujang", "Oyster sauce", "Fish sauce", "Cornstarch",
            "Baking soda", "Olive oil", "Frank's RedHot", "Worcestershire",
            "Ketchup", "Mustard", "Low-fat mayo", "Chili powder", "Cumin",
            "Smoked paprika", "Paprika", "Coriander", "Turmeric", "Cinnamon",
            "Oregano", "Garlic powder", "Onion powder", "Red pepper flakes",
        ])
    ],
    "dishes": [
        # ── WEEK 1 — ASIAN ─────────────────────────────────────────────
        {
            "id": 1, "name": "Teriyaki Chicken Bowls", "template": "asian",
            "is_substitute": False, "active": True,
            "macros": {"cal": 630, "protein_g": 65},
            "prep_slot": "stovetop", "spice_rank": 1,
            "ingredients": [
                "1.6kg chicken breast", "360g dry jasmine rice", "900g broccoli",
                "1 tsp baking soda (velveting)", "Green onions + sesame seeds to finish",
            ],
            "sauce": {"name": "Teriyaki", "items": [
                "120ml soy sauce", "3 tbsp honey", "2 tbsp rice vinegar",
                "4 garlic cloves, minced", "1 tbsp grated ginger",
                "1 tbsp cornstarch whisked into 60ml cold water",
            ]},
            "method": [
                "Cut chicken into bite-size pieces. Toss with baking soda, rest 15 min, rinse well, pat completely dry (velveting - THE difference between juicy day-5 chicken and rubber).",
                "Whisk all sauce ingredients in a bowl (cornstarch slurry last). Set aside.",
                "Heat 1 tbsp neutral oil in your largest pan over HIGH heat. Sear chicken in 3 batches - don't crowd it - 4-5 min per batch until golden. Remove each batch to a bowl.",
                "Return all chicken to the pan. Re-whisk the sauce, pour it in, stir constantly 2-3 min until it bubbles and turns glossy and thick.",
                "Steam broccoli 3-4 min (or microwave, covered, 3 min) - stop while it's still bright green; it softens more on reheat.",
                "Portion: rice, chicken, broccoli. Top with green onion + sesame seeds.",
            ],
            "shopping": [
                {"cat": "meat", "item": "Chicken breast", "qty": "1.6kg (~3.5 lb)"},
                {"cat": "carbs", "item": "Jasmine rice", "qty": "360g dry"},
                {"cat": "produce", "item": "Broccoli", "qty": "900g (2-3 crowns)"},
                {"cat": "produce", "item": "Garlic", "qty": "1 head"},
                {"cat": "produce", "item": "Ginger", "qty": "1 knob"},
                {"cat": "produce", "item": "Green onions", "qty": "1 bunch"},
                {"cat": "pantry", "item": "Soy / honey / rice vinegar", "qty": ""},
                {"cat": "pantry", "item": "Cornstarch / baking soda", "qty": ""},
            ],
        },
        {
            "id": 2, "name": "Korean Bulgogi Beef Bowls", "template": "asian",
            "is_substitute": False, "active": True,
            "macros": {"cal": 640, "protein_g": 60},
            "prep_slot": "stovetop", "spice_rank": 2,
            "ingredients": [
                "1.5kg 93/7 ground beef", "360g dry rice",
                "180g low-fat mozzarella (30g per bowl)", "2 cucumbers",
            ],
            "sauce": {"name": "Bulgogi", "items": [
                "100ml soy sauce", "2 tbsp gochujang", "2 tbsp honey",
                "1 tbsp sesame oil", "4 garlic cloves, minced", "1 tbsp grated ginger",
                "Quick pickle: cucumbers sliced thin + 3 tbsp rice vinegar + 1 tsp sugar + pinch of salt",
            ]},
            "method": [
                "Whisk sauce ingredients in a bowl. Slice and pickle the cucumbers - let sit while everything else cooks.",
                "Brown beef in a large pan over high heat, breaking it up, 6-8 min. Tilt the pan and spoon off the fat.",
                "Pour in the sauce, simmer 2-3 min until it clings to the meat.",
                "Portion: rice, beef, 30g mozzarella per container (it melts in on reheat - the cheesy bulgogi move), pickled cucumber in the corner or a small separate container to keep the crunch.",
            ],
            "shopping": [
                {"cat": "meat", "item": "93/7 ground beef", "qty": "1.5kg (~3.3 lb)"},
                {"cat": "carbs", "item": "Rice", "qty": "360g dry"},
                {"cat": "produce", "item": "Cucumbers", "qty": "2"},
                {"cat": "dairy", "item": "Low-fat mozzarella", "qty": "180g"},
                {"cat": "pantry", "item": "Gochujang / sesame oil", "qty": ""},
            ],
        },
        {
            "id": 3, "name": "Thai Basil Turkey (Pad Krapow)", "template": "asian",
            "is_substitute": False, "active": True,
            "macros": {"cal": 610, "protein_g": 62},
            "prep_slot": "stovetop", "spice_rank": 3,
            "ingredients": [
                "1.5kg 99% lean ground turkey", "360g dry rice",
                "600g green beans, chopped into 1-inch pieces",
                "2 cups basil leaves", "6 eggs (1 per container)",
            ],
            "sauce": {"name": "Pad krapow", "items": [
                "80ml soy sauce", "3 tbsp oyster sauce", "1 tbsp fish sauce",
                "1 tbsp honey", "6 garlic cloves, minced",
                "1-2 Thai chilis minced (or 1-2 tsp sriracha)",
            ]},
            "method": [
                "Whisk sauce ingredients. Hard-boil the 6 eggs (10 min, then ice water).",
                "Get a wok or large pan screaming hot with 1 tbsp oil. Add turkey and DON'T touch it for 2 min so it browns, then break it up and cook through, ~6 min.",
                "Add garlic + chili, stir 30 seconds. Add green beans + sauce, stir-fry 3 min - beans should stay crisp.",
                "Kill the heat, fold in the basil until just wilted.",
                "Portion over rice, halved egg on top.",
            ],
            "shopping": [
                {"cat": "meat", "item": "99% lean ground turkey", "qty": "1.5kg (~3.3 lb)"},
                {"cat": "meat", "item": "Eggs", "qty": "6"},
                {"cat": "carbs", "item": "Rice", "qty": "360g dry"},
                {"cat": "produce", "item": "Green beans", "qty": "600g"},
                {"cat": "produce", "item": "Basil", "qty": "2 bunches"},
                {"cat": "produce", "item": "Garlic", "qty": "1 head"},
                {"cat": "pantry", "item": "Oyster sauce / fish sauce", "qty": ""},
            ],
        },
        # ── WEEK 2 — TEX-MEX ───────────────────────────────────────────
        {
            "id": 4, "name": "Shredded Chicken Tacos", "template": "texmex",
            "is_substitute": False, "active": True,
            "macros": {"cal": 610, "protein_g": 66},
            "prep_slot": "simmer", "spice_rank": 1,
            "ingredients": [
                "1.6kg chicken breast", "18 corn tortillas (3 per serving, stored in their bag)",
                "Lettuce", "Pico: 2 tomatoes + 1/4 onion + cilantro + lime, diced",
            ],
            "sauce": {"name": "Seasoning + crema", "items": [
                "Simmer: 2 tbsp chili powder + 1 tbsp cumin + 1 tbsp smoked paprika + 1 tsp garlic powder + 1 tsp oregano + 250ml chicken broth",
                "Crema: 300g nonfat Greek yogurt + hot sauce to taste + squeeze of lime + pinch of salt (jar it)",
            ]},
            "method": [
                "Put chicken, all seasoning, and broth in a pot. Bring to a simmer, cover, cook 22-25 min until it shreds easily.",
                "Shred with two forks RIGHT IN the cooking liquid, then simmer uncovered 5 min so the meat drinks the liquid back up - this is why it stays juicy all week.",
                "Mix the crema. Dice the pico.",
                "Store components separately: meat in containers, tortillas in their bag, crema in a jar, pico in a small container.",
                "Daily assembly (~1 min): microwave meat, warm 3 tortillas in a dry pan or 20 sec in the microwave, build with crema + lettuce + pico.",
            ],
            "shopping": [
                {"cat": "meat", "item": "Chicken breast", "qty": "1.6kg (family pack w/ fajitas = ~7 lb)"},
                {"cat": "carbs", "item": "Corn tortillas", "qty": "18"},
                {"cat": "produce", "item": "Lettuce", "qty": "1 head"},
                {"cat": "produce", "item": "Tomatoes", "qty": "2"},
                {"cat": "produce", "item": "Cilantro", "qty": "1 bunch"},
                {"cat": "produce", "item": "Limes", "qty": "1-2"},
                {"cat": "dairy", "item": "Nonfat Greek yogurt", "qty": "large tub (shared this week)"},
                {"cat": "pantry", "item": "Chicken broth / bouillon", "qty": ""},
                {"cat": "pantry", "item": "Hot sauce", "qty": ""},
            ],
        },
        {
            "id": 5, "name": "Burrito Bowls", "template": "texmex",
            "is_substitute": False, "active": True,
            "macros": {"cal": 650, "protein_g": 63},
            "prep_slot": "stovetop", "spice_rank": 2,
            "ingredients": [
                "1.5kg 93/7 ground beef", "300g dry rice",
                "1 can black beans, drained + rinsed", "180g low-fat shredded cheese",
                "Salsa + Greek yogurt for topping (added when eating)",
            ],
            "sauce": {"name": "Taco seasoning", "items": [
                "2 tbsp chili powder", "1 tbsp cumin", "1 tsp smoked paprika",
                "1 tsp garlic powder", "1 tsp oregano", "120ml water",
            ]},
            "method": [
                "Cook rice; when done, stir in juice of 1 lime + a handful of chopped cilantro.",
                "Brown beef over high heat, 6-8 min, drain fat. Add seasoning + water, simmer 3-4 min until saucy.",
                "Warm the beans 2 min in the beef pan (or microwave).",
                "Portion in layers: rice, beans, beef, 30g cheese. Salsa + a spoon of Greek yogurt go on when eating, not before (keeps it from going watery).",
            ],
            "shopping": [
                {"cat": "meat", "item": "93/7 ground beef", "qty": "1.5kg"},
                {"cat": "carbs", "item": "Rice", "qty": "300g dry"},
                {"cat": "produce", "item": "Limes", "qty": "1"},
                {"cat": "produce", "item": "Cilantro", "qty": "(shared)"},
                {"cat": "dairy", "item": "Low-fat shredded cheese", "qty": "180g+"},
                {"cat": "pantry", "item": "Black beans", "qty": "1 can"},
                {"cat": "pantry", "item": "Salsa", "qty": "1 jar"},
            ],
        },
        {
            "id": 6, "name": "Chicken Fajita Bowls", "template": "texmex",
            "is_substitute": False, "active": True,
            "macros": {"cal": 620, "protein_g": 63},
            "prep_slot": "oven", "spice_rank": 1,
            "ingredients": [
                "1.6kg chicken breast, sliced into strips", "360g dry rice",
                "3 bell peppers, sliced", "2 onions, sliced", "2 limes",
            ],
            "sauce": {"name": "Fajita seasoning", "items": [
                "2 tbsp chili powder", "1 tbsp cumin", "1 tbsp paprika",
                "1 tsp garlic powder", "1 tsp oregano", "1 tbsp olive oil",
            ]},
            "method": [
                "Oven to 220C / 425F. Toss chicken strips, peppers, and onions with the oil + all seasoning in one big bowl.",
                "Spread across TWO sheet pans - crowding = steaming = gray chicken. Roast 20 min, stirring once halfway.",
                "Squeeze lime over everything straight out of the oven.",
                "Portion over rice. Easiest dish of the month - one bowl, two pans, zero stovetop.",
            ],
            "shopping": [
                {"cat": "meat", "item": "Chicken breast (strips)", "qty": "1.6kg"},
                {"cat": "carbs", "item": "Rice", "qty": "360g dry"},
                {"cat": "produce", "item": "Bell peppers", "qty": "3-4"},
                {"cat": "produce", "item": "Onions", "qty": "2-3"},
                {"cat": "produce", "item": "Limes", "qty": "2"},
                {"cat": "produce", "item": "Garlic", "qty": "1 head"},
            ],
        },
        # ── WEEK 3 — BURGER / COMFORT ──────────────────────────────────
        {
            "id": 7, "name": "Smash Burger Bowls", "template": "comfort",
            "is_substitute": False, "active": True,
            "macros": {"cal": 640, "protein_g": 61},
            "prep_slot": "oven", "spice_rank": 1,
            "ingredients": [
                "1.5kg 93/7 ground beef", "900g baby potatoes, halved",
                "120g low-fat cheese (20g per bowl)", "Lettuce + pickles (added fresh daily)",
            ],
            "sauce": {"name": "Burger sauce (jar it)", "items": [
                "180g Greek yogurt", "3 tbsp ketchup", "1 tbsp mustard",
                "2 tbsp pickle juice", "1 tsp onion powder", "black pepper",
            ]},
            "method": [
                "Oven to 200C / 400F. Toss halved potatoes with 1 tbsp oil, salt, pepper, garlic powder. Roast cut-side down, 30 min, until crispy.",
                "Divide beef into 12 loose balls. Heat your largest pan/griddle on HIGH. In batches, smash each ball flat with a spatula, season with salt + pepper, sear 2 min until crusty, flip 1 min.",
                "Roughly chop the patties into bite-size pieces.",
                "Portion: potatoes, chopped burger, 20g cheese. Sauce stays in its jar - spoon it on daily with lettuce + pickles so it eats like a burger, not a casserole.",
            ],
            "shopping": [
                {"cat": "meat", "item": "93/7 ground beef", "qty": "1.5kg"},
                {"cat": "carbs", "item": "Baby potatoes", "qty": "900g"},
                {"cat": "produce", "item": "Lettuce", "qty": "1 head"},
                {"cat": "produce", "item": "Pickles", "qty": "1 jar"},
                {"cat": "dairy", "item": "Low-fat cheese", "qty": "120g"},
                {"cat": "dairy", "item": "Greek yogurt", "qty": "1 tub (shared)"},
                {"cat": "pantry", "item": "Ketchup / mustard", "qty": ""},
            ],
        },
        {
            "id": 8, "name": "Turkey Burgers", "template": "comfort",
            "is_substitute": False, "active": True,
            "macros": {"cal": 600, "protein_g": 62},
            "prep_slot": "stovetop", "spice_rank": 2,
            "ingredients": [
                "1.5kg 99% lean ground turkey", "1 egg", "1 tbsp Worcestershire",
                "1 tsp each garlic + onion powder", "6 high-protein buns",
                "6 slices low-fat cheese", "Low-fat mayo, pickles, lettuce",
            ],
            "sauce": {"name": "Fixings", "items": [
                "Low-fat mayo + pickles + lettuce - built fresh daily",
            ]},
            "method": [
                "Mix turkey, egg, Worcestershire, and seasonings gently - overmixing = dense pucks. Form 6 patties slightly wider than your buns (they shrink), press a dimple in the center of each.",
                "Sear in a lightly oiled pan, 4-5 min per side to 74C / 165F internal.",
                "Melt a cheese slice on each during the last minute.",
                "Store: 2 patties in the fridge, 4 in the freezer with parchment between. Buns stay in their bag (freeze half the bag too).",
                "Daily: microwave patty 60-90 sec, toast bun if you can, build with mayo + pickles + lettuce. A fresh-built burger every day beats a soggy prepped one.",
            ],
            "shopping": [
                {"cat": "meat", "item": "99% lean ground turkey", "qty": "1.5kg"},
                {"cat": "meat", "item": "Egg", "qty": "1"},
                {"cat": "carbs", "item": "High-protein burger buns", "qty": "6"},
                {"cat": "produce", "item": "Lettuce", "qty": "(shared)"},
                {"cat": "dairy", "item": "Low-fat cheese slices", "qty": "6"},
                {"cat": "pantry", "item": "Worcestershire / low-fat mayo", "qty": ""},
            ],
        },
        {
            "id": 9, "name": "Philly Cheesesteak Bowls", "template": "comfort",
            "is_substitute": False, "active": True,
            "macros": {"cal": 650, "protein_g": 60},
            "prep_slot": "stovetop", "spice_rank": 3,
            "ingredients": [
                "1.5kg thin-sliced sirloin (or 93/7 ground beef)", "360g dry rice",
                "2 bell peppers, sliced", "2 onions, sliced",
                "180g provolone or low-fat mozzarella (30g per bowl)", "2 tbsp Worcestershire",
            ],
            "sauce": {"name": "Pan sauce", "items": [
                "2 tbsp Worcestershire over the softened peppers + onions",
            ]},
            "method": [
                "If using sirloin: freeze 20 min, then slice paper-thin against the grain. Season with salt + pepper.",
                "Sear beef over HIGH heat in 2-3 batches, 1-2 min per batch - just browned. Remove.",
                "Same pan: peppers + onions with a pinch of salt, 6-8 min until soft and browned at the edges. Add Worcestershire, scrape up the brown bits.",
                "Combine beef back in, kill the heat.",
                "Portion over rice, 30g cheese on top of each - it melts into the meat on reheat.",
            ],
            "shopping": [
                {"cat": "meat", "item": "Thin-sliced sirloin", "qty": "1.5kg (or 93/7 beef)"},
                {"cat": "carbs", "item": "Rice", "qty": "360g dry"},
                {"cat": "produce", "item": "Bell peppers", "qty": "2"},
                {"cat": "produce", "item": "Onions", "qty": "2"},
                {"cat": "dairy", "item": "Provolone / mozzarella", "qty": "180g"},
            ],
        },
        # ── WEEK 4 — PASTA + MEDITERRANEAN ─────────────────────────────
        {
            "id": 10, "name": "Buffalo Chicken Protein Pasta", "template": "pasta_med",
            "is_substitute": False, "active": True,
            "macros": {"cal": 630, "protein_g": 72},
            "prep_slot": "simmer", "spice_rank": 2,
            "ingredients": [
                "1.5kg chicken breast", "510g dry protein pasta",
                "Celery, diced, for crunch",
            ],
            "sauce": {"name": "Buffalo yogurt", "items": [
                "450g nonfat Greek yogurt", "120ml Frank's RedHot",
                "60g light cream cheese, softened", "1 tsp garlic powder",
            ]},
            "method": [
                "Poach chicken: cover with water, pinch of salt, simmer 20 min. Shred with forks (save the poaching liquid).",
                "Cook pasta 1 minute UNDER the package time - it finishes softening on reheat. Drain, keep a cup of pasta water.",
                "Let the pasta cool 2 min (important - boiling-hot pasta splits yogurt). Stir in the buffalo sauce, loosening with splashes of pasta water or poaching liquid until it coats everything.",
                "Fold in the shredded chicken.",
                "Portion; diced celery on top for crunch. Your highest-protein meal of the month.",
            ],
            "shopping": [
                {"cat": "meat", "item": "Chicken breast", "qty": "1.5kg"},
                {"cat": "carbs", "item": "Protein pasta", "qty": "510g (2 boxes total this week)"},
                {"cat": "produce", "item": "Celery", "qty": "1 bunch"},
                {"cat": "dairy", "item": "Nonfat Greek yogurt", "qty": "large tub (~750g needed this week)"},
                {"cat": "dairy", "item": "Light cream cheese", "qty": "60g"},
                {"cat": "pantry", "item": "Frank's RedHot", "qty": ""},
            ],
        },
        {
            "id": 11, "name": "Balsamic Chicken Caprese Pasta", "template": "pasta_med",
            "is_substitute": False, "active": True,
            "macros": {"cal": 640, "protein_g": 65},
            "prep_slot": "stovetop", "spice_rank": 1,
            "ingredients": [
                "1.5kg chicken breast, cubed", "450g dry protein pasta",
                "180g mozzarella pearls", "2 pints cherry tomatoes, halved",
                "1 bunch basil", "1 tbsp olive oil",
            ],
            "sauce": {"name": "Balsamic glaze", "items": [
                "80ml balsamic vinegar, simmered alone in a small pan 8-10 min until it coats a spoon (watch it - glaze goes to burnt fast)",
            ]},
            "method": [
                "Start the glaze in a small pan on low.",
                "Season cubed chicken with salt, pepper, garlic powder, oregano. Sear over high heat in 2 batches, 5-6 min until golden and cooked through.",
                "Cook pasta 1 min under package time, drain, toss with the olive oil so it doesn't clump.",
                "Combine pasta + chicken + halved tomatoes while warm.",
                "Portion, then add the cold stuff COLD: mozzarella pearls, torn basil, drizzle of glaze on each container. The pearls stay intact instead of melting into goo.",
            ],
            "shopping": [
                {"cat": "meat", "item": "Chicken breast", "qty": "1.5kg"},
                {"cat": "carbs", "item": "Protein pasta", "qty": "450g"},
                {"cat": "produce", "item": "Cherry tomatoes", "qty": "2 pints"},
                {"cat": "produce", "item": "Basil", "qty": "1 bunch"},
                {"cat": "dairy", "item": "Mozzarella pearls", "qty": "180g"},
                {"cat": "pantry", "item": "Balsamic vinegar", "qty": ""},
            ],
        },
        {
            "id": 12, "name": "Chicken Shawarma Bowls", "template": "pasta_med",
            "is_substitute": False, "active": True,
            "macros": {"cal": 630, "protein_g": 63},
            "prep_slot": "oven", "spice_rank": 1,
            "ingredients": [
                "1.6kg chicken thighs, trimmed (or breast)", "360g dry rice",
                "2 cucumbers + 2 tomatoes, diced, with lemon + salt",
            ],
            "sauce": {"name": "Shawarma marinade + yogurt sauce", "items": [
                "Marinade: 2 tbsp olive oil + 1 tbsp each cumin, paprika, coriander + 1 tsp turmeric + 1/2 tsp cinnamon + juice of 1 lemon + 6 garlic cloves, minced + 1 tsp salt",
                "Yogurt sauce (jar it, ~8g protein/serving): 300g Greek yogurt + juice of 1/2 lemon + 1 grated garlic clove + 1 tbsp chopped dill + pinch of salt",
            ]},
            "method": [
                "Toss chicken in the marinade - even 30 min while you prep everything else works; overnight is better if you plan ahead.",
                "Oven to 220C / 425F. Roast chicken on a sheet pan 22 min until charred at the edges. Rest 5 min, slice into strips.",
                "Mix the yogurt sauce and the cucumber-tomato salad.",
                "Portion: rice, chicken, salad tucked to the side. Yogurt sauce stays in the jar - spoon on daily so the bowl doesn't go watery.",
            ],
            "shopping": [
                {"cat": "meat", "item": "Chicken thighs (trimmed)", "qty": "1.6kg (bulk pack week, ~10 lb total)"},
                {"cat": "carbs", "item": "Rice", "qty": "360g dry"},
                {"cat": "produce", "item": "Cucumbers", "qty": "2"},
                {"cat": "produce", "item": "Tomatoes", "qty": "2"},
                {"cat": "produce", "item": "Lemons", "qty": "2"},
                {"cat": "produce", "item": "Fresh dill (or dried)", "qty": "1 bunch"},
                {"cat": "produce", "item": "Garlic", "qty": "1 head"},
                {"cat": "dairy", "item": "Greek yogurt", "qty": "300g+ (shared tub)"},
            ],
        },
        # ── SUBSTITUTES — bench players, same ~600 cal / ~60g protein template ──
        {
            "id": 13, "name": "Orange Chicken", "template": "asian",
            "is_substitute": True, "active": True,
            "macros": {"cal": 620, "protein_g": 63},
            "prep_slot": "stovetop", "spice_rank": 1,
            "ingredients": [
                "1.6kg chicken breast, cubed + velveted (1 tsp baking soda, 15 min, rinse, dry)",
                "360g dry rice", "900g broccoli",
            ],
            "sauce": {"name": "Orange glaze", "items": [
                "Juice + zest of 2 oranges", "80ml soy sauce", "2 tbsp honey",
                "2 tbsp rice vinegar", "4 garlic cloves, minced", "1 tbsp grated ginger",
                "1 tbsp cornstarch whisked into 60ml cold water",
            ]},
            "method": [
                "Velvet and sear the chicken in batches over high heat, like the teriyaki.",
                "Pour in the sauce, stir 2-3 min until glossy and thick.",
                "Portion with rice + steamed broccoli.",
            ],
            "shopping": [
                {"cat": "meat", "item": "Chicken breast", "qty": "1.6kg"},
                {"cat": "carbs", "item": "Rice", "qty": "360g dry"},
                {"cat": "produce", "item": "Broccoli", "qty": "900g"},
                {"cat": "produce", "item": "Oranges", "qty": "2"},
                {"cat": "produce", "item": "Garlic / ginger", "qty": ""},
            ],
        },
        {
            "id": 14, "name": "Honey Garlic Shrimp Fried Rice", "template": "asian",
            "is_substitute": True, "active": True,
            "macros": {"cal": 600, "protein_g": 58},
            "prep_slot": "stovetop", "spice_rank": 2,
            "ingredients": [
                "1.4kg shrimp, peeled", "360g dry rice (cook first and chill - dry rice fries better)",
                "6 eggs", "400g frozen peas + carrots", "Green onions",
            ],
            "sauce": {"name": "Honey garlic", "items": [
                "80ml soy sauce", "2 tbsp honey", "1 tbsp sesame oil",
                "6 garlic cloves, minced", "1 tbsp grated ginger",
            ]},
            "method": [
                "Scramble the eggs in a hot pan, set aside.",
                "Sear shrimp 1-2 min per side until just pink, set aside.",
                "Fry the chilled rice + peas/carrots over high heat, add sauce, then fold shrimp + eggs back in.",
                "Portion; green onions on top.",
            ],
            "shopping": [
                {"cat": "meat", "item": "Shrimp (peeled)", "qty": "1.4kg"},
                {"cat": "meat", "item": "Eggs", "qty": "6"},
                {"cat": "carbs", "item": "Rice", "qty": "360g dry"},
                {"cat": "produce", "item": "Frozen peas + carrots", "qty": "400g"},
                {"cat": "produce", "item": "Green onions", "qty": "1 bunch"},
                {"cat": "produce", "item": "Garlic / ginger", "qty": ""},
            ],
        },
        {
            "id": 15, "name": "Turkey Chili", "template": "texmex",
            "is_substitute": True, "active": True,
            "macros": {"cal": 610, "protein_g": 64},
            "prep_slot": "simmer", "spice_rank": 3,
            "ingredients": [
                "1.5kg 99% lean ground turkey", "2 cans kidney/black beans, drained",
                "1 can crushed tomatoes", "2 onions, diced", "2 bell peppers, diced",
                "300g dry rice (or serve on its own)",
            ],
            "sauce": {"name": "Chili base", "items": [
                "2 tbsp chili powder", "1 tbsp cumin", "1 tbsp smoked paprika",
                "1 tsp oregano", "chicken broth to loosen",
            ]},
            "method": [
                "Brown the turkey hard, then soften onions + peppers in the same pot.",
                "Add beans, tomatoes, and spices; simmer 30 min, loosening with broth as needed.",
                "Portion over rice (or alone). Greek yogurt on top when eating.",
            ],
            "shopping": [
                {"cat": "meat", "item": "99% lean ground turkey", "qty": "1.5kg"},
                {"cat": "carbs", "item": "Rice", "qty": "300g dry (optional)"},
                {"cat": "produce", "item": "Onions", "qty": "2"},
                {"cat": "produce", "item": "Bell peppers", "qty": "2"},
                {"cat": "pantry", "item": "Kidney/black beans", "qty": "2 cans"},
                {"cat": "pantry", "item": "Crushed tomatoes", "qty": "1 can"},
            ],
        },
        {
            "id": 16, "name": "Greek Meatballs", "template": "pasta_med",
            "is_substitute": True, "active": True,
            "macros": {"cal": 620, "protein_g": 61},
            "prep_slot": "oven", "spice_rank": 1,
            "ingredients": [
                "1.5kg 93/7 ground beef (or beef/lamb mix)", "1 egg",
                "1 tbsp oregano + 4 garlic cloves, minced", "360g dry rice",
                "2 cucumbers + 2 tomatoes, diced, with lemon + salt",
            ],
            "sauce": {"name": "Tzatziki (jar it)", "items": [
                "300g Greek yogurt", "juice of 1/2 lemon", "1 grated garlic clove",
                "1 tbsp chopped dill", "1/2 grated cucumber, squeezed dry", "pinch of salt",
            ]},
            "method": [
                "Mix meat, egg, oregano, garlic, salt + pepper gently. Roll ~30 meatballs.",
                "Roast at 220C / 425F for 18 min on a sheet pan.",
                "Mix the tzatziki and the cucumber-tomato salad.",
                "Portion: rice, meatballs, salad to the side. Tzatziki stays in the jar - spoon on daily.",
            ],
            "shopping": [
                {"cat": "meat", "item": "93/7 ground beef (or lamb mix)", "qty": "1.5kg"},
                {"cat": "meat", "item": "Egg", "qty": "1"},
                {"cat": "carbs", "item": "Rice", "qty": "360g dry"},
                {"cat": "produce", "item": "Cucumbers", "qty": "3"},
                {"cat": "produce", "item": "Tomatoes", "qty": "2"},
                {"cat": "produce", "item": "Lemon / dill / garlic", "qty": ""},
                {"cat": "dairy", "item": "Greek yogurt", "qty": "300g"},
            ],
        },
    ],
}

# Per-dish serving count, active cook time, and the meal-prep-critical store/reheat
# note. Kept out of the dish dicts above to keep those readable; applied on import.
_DISH_TIME = {
    1: "~35 min", 2: "~30 min", 3: "~35 min", 4: "~35 min", 5: "~30 min",
    6: "~30 min (mostly oven)", 7: "~45 min", 8: "~30 min", 9: "~30 min",
    10: "~30 min", 11: "~30 min", 12: "~35 min (+ marinate)", 13: "~35 min",
    14: "~30 min (rice chilled ahead)", 15: "~45 min", 16: "~35 min",
}
_BOWL_REHEAT = ("Fridge days 1-4, freezer days 5-6 (up to ~2 months). Thaw frozen "
                "overnight in the fridge; reheat 2-3 min with a splash of water over the rice.")
_DISH_REHEAT = {
    1: _BOWL_REHEAT,
    2: _BOWL_REHEAT + " Keep the pickled cucumber separate for crunch.",
    3: _BOWL_REHEAT + " Add the halved egg after reheating.",
    4: ("Store the meat, tortillas, crema, and pico separately. Reheat the meat "
        "60-90 sec; warm 3 tortillas in a dry pan or 20 sec in the microwave; build "
        "with crema + lettuce + pico fresh each day."),
    5: _BOWL_REHEAT + " Add salsa + Greek yogurt when eating, not before (keeps it from going watery).",
    6: _BOWL_REHEAT,
    7: ("Reheat the potatoes + chopped burger ~2 min. Spoon the burger sauce on and "
        "add lettuce + pickles fresh so it eats like a burger, not a casserole."),
    8: ("Fridge 2 patties, freeze 4 with parchment between (freeze half the buns too). "
        "Microwave a patty 60-90 sec, toast a fresh bun, build with mayo + pickles + lettuce."),
    9: _BOWL_REHEAT + " Cheese melts into the meat on reheat.",
    10: ("Reheat gently with a splash of water - do NOT boil (the yogurt splits). "
         "Add the diced celery after reheating for crunch."),
    11: ("Reheat the pasta + chicken with a splash of water. Add the mozzarella pearls, "
         "torn basil, and balsamic glaze COLD, after reheating."),
    12: _BOWL_REHEAT + " Yogurt sauce stays in its jar - spoon on daily so the bowl doesn't go watery.",
    13: _BOWL_REHEAT,
    14: ("Fridge days 1-4, freezer days 5-6. Reheat 2-3 min in the microwave or a hot "
         "pan; a splash of water keeps the rice from drying out."),
    15: _BOWL_REHEAT + " Great on its own or over rice; Greek yogurt on top when eating.",
    16: _BOWL_REHEAT + " Tzatziki stays in the jar - spoon on daily.",
}
for _d in MEALPREP_DEFAULT["dishes"]:
    _d.setdefault("serves", 6)
    _d["time"] = _DISH_TIME.get(_d["id"], "~35 min")
    _d["reheat"] = _DISH_REHEAT.get(_d["id"], _BOWL_REHEAT)
