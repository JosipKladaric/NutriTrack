const DEFAULT_PROFILE = {
    name: 'Josip D.',
    gender: 'male',
    age: 30,
    weight: 80,
    height: 180,
    insulinSensitivity: 'normal',
    digestionSpeed: 'normal'
};

const DAY_ACTIVITY_FACTORS = {
    rest: 1.0,
    light: 1.08,
    moderate: 1.18,
    high: 1.3,
    intense: 1.42
};

const OIL_LEVELS = {
    none: 0,
    low: 5,
    medium: 10,
    high: 15
};

const MODEL_CONSTANTS = {
    // Literature anchors:
    // - Healthy postprandial glucose usually peaks about 30-60 min and trends back toward baseline by 2-3 h,
    //   with complete carbohydrate absorption often requiring up to 5-6 h (PMC6781941).
    // - Healthy real-world CGM data showed average postprandial time-to-peak glucose of 97 min (PMC8120054).
    // - Gastric emptying T50 for low-fat mixed meals commonly falls within 30-180 min, midpoint ~105 min (PMC10078504).
    // - Postprandial triglycerides typically peak around 3-4 h and return toward baseline over 6-8 h (PMC7014867).
    // - Two days of partial sleep deprivation reduced postprandial insulin sensitivity by about 22% (PMC5123208).
    // - Short-term exercise training improved insulin sensitivity by about 11-15% in lean/obese adults (PMC3920903).
    // - Ageing slows gastric emptying modestly; older men emptied protein drinks ~20% slower than young men (0.8 vs 1.0 kcal/min) (PMC4666943 / PMC6627312).
    gastricEmptying: {
        mixedMealT50Minutes: 105,
        energySensitivityPer1000Kcal: 0.36,
        fatSensitivityPerGram: 0.013,
        fiberSensitivityPerGram: 0.018,
        proteinSensitivityPerGram: 0.004
    },
    glucose: {
        peakMinutes: 60,
        cgmPeakMinutes: 97,
        normalizationMinutes: 150,
        completionMinutes: 330
    },
    lipid: {
        peakMinutes: 240,
        recoveryMinutes: 420
    },
    macros: {
        carbs: {
            gastricHalfLifeHours: 0.95,
            absorptionHalfLifeHours: 0.75,
            utilizationHalfLifeHours: 0.9
        },
        protein: {
            gastricHalfLifeHours: 1.45,
            absorptionHalfLifeHours: 1.3,
            utilizationHalfLifeHours: 1.5
        },
        fat: {
            gastricHalfLifeHours: 2.4,
            absorptionHalfLifeHours: 2.5,
            utilizationHalfLifeHours: 2.6
        }
    },
    profile: {
        insulinSensitivity: {
            low: 0.85,
            normal: 1.0,
            high: 1.15
        },
        digestionSpeed: {
            slow: 0.85,
            normal: 1.0,
            fast: 1.15
        },
        sleepRestrictionPenaltyPerHourUnder7: 0.073,
        maxSleepPenalty: 0.22,
        activityInsulinBoost: {
            rest: 1.0,
            light: 1.05,
            moderate: 1.11,
            high: 1.15,
            intense: 1.15
        },
        ageGastricSlowdownPerYearAfter60: 0.005,
        maxAgeGastricSlowdown: 0.2
    },
    simulation: {
        dtHours: 0.5,
        minHorizonHours: 4.5,
        maxHorizonHours: 14,
        residualStopKcal: 0.8,
        displayedStopKcalPerHour: 0.32
    }
};

const FALLBACK_DB = [
    { name: 'Avokado', calories: 160, protein: 2, carbs: 9, fat: 15, fiber: 6.7, gi: 15, interaction: 'Poboljšava apsorpciju vitamina topivih u mastima poput A, D, E i K.', category: 'voće', aliases: ['avocado'] },
    { name: 'Banana', calories: 89, protein: 1.1, carbs: 23, fat: 0.3, fiber: 2.6, gi: 51, interaction: 'Kalij može pomoći ravnoteži natrija nakon obroka.', category: 'voće', aliases: [] }
];

const state = {
    days: loadDays(),
    userProfile: JSON.parse(localStorage.getItem('userProfile')) || DEFAULT_PROFILE,
    currentDayId: null,
    currentMealId: null
};

let foodDb = [];
let energyChartInstance = null;

const selectors = {
    daysList: document.getElementById('days-list'),
    dayContent: document.getElementById('day-content'),
    emptyState: document.getElementById('empty-state'),
    addDayBtn: document.getElementById('add-day-btn'),
    addMealBtn: document.getElementById('add-meal-btn'),
    dayDate: document.getElementById('day-date'),
    daySleep: document.getElementById('day-sleep'),
    dayWakeTime: document.getElementById('day-wake-time'),
    dayActivity: document.getElementById('day-activity'),
    dayMealsList: document.getElementById('day-meals-list'),
    dayMealCount: document.getElementById('day-meal-count'),
    mealEditorSection: document.getElementById('meal-editor-section'),
    mealEmptyState: document.getElementById('meal-empty-state'),
    mealTitle: document.getElementById('meal-title'),
    mealTimestamp: document.getElementById('meal-timestamp'),
    mealCooking: document.getElementById('meal-cooking'),
    mealOil: document.getElementById('meal-oil'),
    ingredientsList: document.getElementById('ingredients-list'),
    searchInput: document.getElementById('ingredient-search'),
    searchResults: document.getElementById('search-results'),
    quickAddBtn: document.getElementById('quick-add-btn'),
    nutritionData: document.getElementById('nutrition-data'),
    interactionsList: document.getElementById('interactions-list'),
    recommendationsList: document.getElementById('recommendations-list'),
    profileTrigger: document.getElementById('profile-trigger'),
    profileModal: document.getElementById('profile-modal'),
    closeProfileBtn: document.getElementById('close-profile-btn'),
    saveProfileBtn: document.getElementById('save-profile-btn'),
    userDisplayName: document.getElementById('user-display-name'),
    userInitials: document.getElementById('user-initials'),
    userDailyStatus: document.getElementById('user-daily-status')
};

init();

async function init() {
    try {
        const response = await fetch('foods.json');
        foodDb = response.ok ? await response.json() : FALLBACK_DB;
    } catch {
        foodDb = FALLBACK_DB;
    }

    setupEventListeners();
    renderDaysList();
    updateProfileSummary();

    if (state.days.length > 0) selectDay(state.days[0].id);
    else showEmptyState();
}

function loadDays() {
    const storedDays = localStorage.getItem('days');
    if (storedDays) {
        try {
            const parsed = JSON.parse(storedDays);
            return parsed.map((day) => ({
                ...day,
                sleepHours: day.sleepHours ?? 8,
                wakeTime: day.wakeTime || '07:00',
                activityLoad: day.activityLoad || 'moderate',
                meals: (day.meals || []).map(normalizeMeal)
            }));
        } catch {
            return [];
        }
    }

    const legacyMeals = JSON.parse(localStorage.getItem('meals') || '[]');
    if (!Array.isArray(legacyMeals) || legacyMeals.length === 0) return [];

    const groupedDays = new Map();
    legacyMeals.forEach((meal) => {
        const dateKey = toDayKey(meal.timestamp);
        if (!groupedDays.has(dateKey)) {
            groupedDays.set(dateKey, {
                id: `${dateKey}-${Math.random().toString(36).slice(2, 7)}`,
                date: dateKey,
                sleepHours: 8,
                wakeTime: '07:00',
                activityLoad: 'moderate',
                meals: []
            });
        }
        groupedDays.get(dateKey).meals.push(normalizeMeal(meal));
    });

    return Array.from(groupedDays.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function normalizeMeal(meal) {
    return {
        id: meal.id || Date.now().toString(),
        name: meal.name || 'Novi obrok',
        timestamp: meal.timestamp || new Date().toISOString(),
        ingredients: meal.ingredients || [],
        cookingMethod: meal.cookingMethod || 'boiled',
        oilLevel: meal.oilLevel || 'none'
    };
}

function setupEventListeners() {
    selectors.addDayBtn.onclick = createNewDay;
    selectors.addMealBtn.onclick = createNewMeal;
    selectors.dayDate.onchange = (e) => updateDayDate(e.target.value);
    selectors.daySleep.oninput = (e) => updateDaySleep(e.target.value);
    selectors.dayWakeTime.onchange = (e) => updateDayWakeTime(e.target.value);
    selectors.dayActivity.onchange = (e) => updateDayActivity(e.target.value);
    selectors.mealTitle.oninput = (e) => updateMealField('name', e.target.value);
    selectors.mealTimestamp.onchange = (e) => updateMealField('timestamp', new Date(e.target.value).toISOString());
    selectors.mealCooking.onchange = (e) => updateMealField('cookingMethod', e.target.value);
    selectors.mealOil.onchange = (e) => updateMealField('oilLevel', e.target.value);
    selectors.searchInput.oninput = handleIngredientSearch;
    selectors.searchInput.onkeydown = handleIngredientEnter;
    selectors.quickAddBtn.onclick = quickAddIngredient;
    window.addEventListener('click', handleWindowClick);
    selectors.profileTrigger.onclick = openProfileModal;
    selectors.closeProfileBtn.onclick = () => selectors.profileModal.classList.remove('active');
    selectors.saveProfileBtn.onclick = saveProfile;
}

function handleIngredientSearch(event) {
    const query = event.target.value.toLowerCase();
    if (query.length < 1) {
        selectors.searchResults.style.display = 'none';
        return;
    }

    const filtered = foodDb.filter((food) => matchesFoodQuery(food, query)).slice(0, 20);
    if (!filtered.length) {
        selectors.searchResults.style.display = 'none';
        return;
    }

    selectors.searchResults.style.display = 'block';
    renderSearchResults(filtered);
}

function handleIngredientEnter(event) {
    if (event.key !== 'Enter') return;
    const first = selectors.searchResults.querySelector('.search-item');
    if (first) first.click();
}

function quickAddIngredient() {
    const query = selectors.searchInput.value.toLowerCase();
    const found = foodDb.find((food) => matchesFoodQuery(food, query));
    if (found) addIngredientToMeal(found.name);
}

function handleWindowClick(event) {
    if (!selectors.searchInput.contains(event.target) && !selectors.searchResults.contains(event.target)) {
        selectors.searchResults.style.display = 'none';
    }
    if (event.target === selectors.profileModal) selectors.profileModal.classList.remove('active');
}

function createNewDay() {
    const today = toDayKey(new Date());
    const existing = state.days.find((day) => day.date === today);
    if (existing) {
        selectDay(existing.id);
        return;
    }

    const day = {
        id: `${today}-${Date.now()}`,
        date: today,
        sleepHours: 8,
        wakeTime: '07:00',
        activityLoad: 'moderate',
        meals: []
    };
    state.days.unshift(day);
    saveState();
    renderDaysList();
    selectDay(day.id);
}

function createNewMeal() {
    const day = getCurrentDay();
    if (!day) return;

    const baseDate = day.date === toDayKey(new Date()) ? new Date() : new Date(`${day.date}T12:00`);
    const meal = {
        id: Date.now().toString(),
        name: `Obrok ${day.meals.length + 1}`,
        timestamp: baseDate.toISOString(),
        ingredients: [],
        cookingMethod: 'boiled',
        oilLevel: 'none'
    };
    day.meals.push(meal);
    day.meals.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    saveState();
    renderDayMeals(day);
    selectMeal(meal.id);
    updateDayAnalysis(day);
}

function selectDay(dayId) {
    state.currentDayId = dayId;
    const day = getCurrentDay();
    if (!day) return;

    renderDaysList();
    selectors.emptyState.classList.add('hidden');
    selectors.dayContent.classList.remove('hidden');
    selectors.dayDate.value = day.date;
    selectors.daySleep.value = day.sleepHours;
    selectors.dayWakeTime.value = day.wakeTime || '07:00';
    selectors.dayActivity.value = day.activityLoad;

    if (!day.meals.some((meal) => meal.id === state.currentMealId)) {
        state.currentMealId = day.meals[0]?.id || null;
    }

    renderDayMeals(day);
    renderMealEditor();
    updateDayAnalysis(day);
}

function selectMeal(mealId) {
    state.currentMealId = mealId;
    renderDayMeals(getCurrentDay());
    renderMealEditor();
}

function renderDaysList() {
    if (state.days.length === 0) {
        selectors.daysList.innerHTML = '<div class="empty-state" style="padding: 20px; text-align: center; color: var(--color-neutral-foreground-3);">Još nema spremljenih dana.</div>';
        return;
    }

    const sortedDays = [...state.days].sort((a, b) => b.date.localeCompare(a.date));
    selectors.daysList.innerHTML = sortedDays.map((day) => {
        const totals = calculateDayTotals(day);
        return `
            <div class="meal-item ${day.id === state.currentDayId ? 'active' : ''}" onclick="selectDay('${day.id}')" style="margin: 4px 8px; border-radius: 6px;">
                <span class="meal-name" style="font-size: 13px;">${formatDayLabel(day.date)}</span>
                <span class="meal-time" style="font-size: 11px; opacity: 0.7;">${day.meals.length} obroka · ${Math.round(totals.cals)} kcal</span>
            </div>
        `;
    }).join('');
}

function renderDayMeals(day) {
    selectors.dayMealCount.textContent = `${day.meals.length} obroka`;
    if (!day.meals.length) {
        selectors.dayMealsList.innerHTML = '<div style="padding: 14px; border: 1px dashed var(--color-neutral-stroke-1); border-radius: 8px; color: var(--color-neutral-foreground-3);">Nema obroka za ovaj dan.</div>';
        return;
    }

    selectors.dayMealsList.innerHTML = [...day.meals]
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .map((meal, index) => {
            const totals = calculateMealTotals(meal);
            return `
                <div class="meal-item meal-row-compact ${meal.id === state.currentMealId ? 'active' : ''}" onclick="selectMeal('${meal.id}')" style="margin-bottom: 0;">
                    <div>
                        <span class="meal-name">${meal.name || `Obrok ${index + 1}`}</span>
                        <span class="meal-time">${formatTime(meal.timestamp)} · ${Math.round(totals.cals)} kcal</span>
                    </div>
                    <button onclick="event.stopPropagation(); removeMeal('${meal.id}')" class="icon-btn" style="color: var(--color-error);">×</button>
                </div>
            `;
        }).join('');
}

function renderMealEditor() {
    const meal = getCurrentMeal();
    if (!meal) {
        selectors.mealEditorSection.classList.add('hidden');
        selectors.mealEmptyState.classList.remove('hidden');
        selectors.ingredientsList.innerHTML = '';
        return;
    }

    selectors.mealEditorSection.classList.remove('hidden');
    selectors.mealEmptyState.classList.add('hidden');
    selectors.mealTitle.value = meal.name;
    selectors.mealTimestamp.value = toLocalDateTimeValue(meal.timestamp);
    selectors.mealCooking.value = meal.cookingMethod;
    selectors.mealOil.value = meal.oilLevel;
    renderIngredients(meal.ingredients);
}

function renderIngredients(ingredients) {
    selectors.ingredientsList.innerHTML = ingredients.length ? ingredients.map((ingredient, index) => `
        <li class="ingredient-item">
            <div style="display: flex; align-items: center; gap: 8px;">
                <button onclick="removeIngredient(${index})" class="icon-btn" style="padding: 4px; color: var(--color-error);"><svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.77 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.77a.75.75 0 101.06-1.06L11.06 10l4.77-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.23 4.22z"/></svg></button>
                <span class="name">${ingredient.name}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
                <input type="number" value="${ingredient.amount}" min="1" max="5000" oninput="updateIngredientAmount(${index}, this.value)" style="width: 50px; border: none; background: var(--color-neutral-background-3); border-radius: 4px; padding: 2px 4px; font-size: 12px; font-weight: 600; text-align: right; color: var(--color-neutral-foreground-1); outline: none;">
                <span style="font-size: 12px; color: var(--color-neutral-foreground-3); font-weight: 600;">g</span>
            </div>
        </li>
    `).join('') : '<li class="placeholder-text" style="color: var(--color-neutral-foreground-3); font-style: italic; padding: 12px;">Upiši iznad za dodavanje namirnica.</li>';
}

function removeMeal(mealId) {
    const day = getCurrentDay();
    if (!day) return;
    day.meals = day.meals.filter((meal) => meal.id !== mealId);
    if (state.currentMealId === mealId) state.currentMealId = day.meals[0]?.id || null;
    saveState();
    renderDayMeals(day);
    renderMealEditor();
    updateDayAnalysis(day);
}

function updateMealField(field, value) {
    const meal = getCurrentMeal();
    if (!meal) return;
    meal[field] = value;
    if (field === 'timestamp') getCurrentDay().meals.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    saveState();
    renderDayMeals(getCurrentDay());
    updateDayAnalysis(getCurrentDay());
}

function updateDayDate(value) {
    const day = getCurrentDay();
    if (!day || !value) return;

    const existing = state.days.find((item) => item.date === value && item.id !== day.id);
    if (existing) {
        selectors.dayDate.value = day.date;
        return;
    }

    day.date = value;
    day.meals.forEach((meal) => {
        const date = new Date(meal.timestamp);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        meal.timestamp = new Date(`${value}T${hours}:${minutes}:00`).toISOString();
    });

    saveState();
    renderDaysList();
    updateDayAnalysis(day);
}

function updateDaySleep(value) {
    const day = getCurrentDay();
    if (!day) return;
    day.sleepHours = clamp(Number(value) || 0, 0, 16);
    saveState();
    updateDayAnalysis(day);
}

function updateDayWakeTime(value) {
    const day = getCurrentDay();
    if (!day || !value) return;
    day.wakeTime = value;
    saveState();
    updateDayAnalysis(day);
}

function updateDayActivity(value) {
    const day = getCurrentDay();
    if (!day) return;
    day.activityLoad = value;
    saveState();
    updateDayAnalysis(day);
}

function removeIngredient(index) {
    const meal = getCurrentMeal();
    if (!meal) return;
    meal.ingredients.splice(index, 1);
    saveState();
    renderIngredients(meal.ingredients);
    updateDayAnalysis(getCurrentDay());
}

function updateIngredientAmount(index, value) {
    const meal = getCurrentMeal();
    if (!meal || !meal.ingredients[index]) return;
    meal.ingredients[index].amount = parseInt(value) || 0;
    saveState();
    updateDayAnalysis(getCurrentDay());
}

function addIngredientToMeal(name) {
    const meal = getCurrentMeal();
    if (!meal) return;
    const food = foodDb.find((item) => item.name === name);
    if (!food) return;
    meal.ingredients.push({ ...food, amount: 100 });
    saveState();
    renderIngredients(meal.ingredients);
    selectors.searchInput.value = '';
    selectors.searchResults.style.display = 'none';
    updateDayAnalysis(getCurrentDay());
}

function normalizeText(value) {
    return (value || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function matchesFoodQuery(food, query) {
    const normalized = normalizeText(query.trim());
    if (!normalized) return false;
    return [food.name, food.category, ...(food.aliases || [])]
        .map(normalizeText)
        .some((value) => value.includes(normalized));
}

function renderSearchResults(results) {
    selectors.searchResults.innerHTML = results.map((food) => `
        <div class="search-item" onclick="addIngredientToMeal('${food.name}')" style="padding: 10px 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-neutral-stroke-2);">
            <div style="display: flex; flex-direction: column; gap: 2px;">
                <span style="font-size: 14px; font-weight: 600; color: var(--color-neutral-foreground-1);">${food.name}</span>
                <span style="font-size: 11px; color: var(--color-neutral-foreground-3); text-transform: capitalize;">${food.category || 'ostalo'}</span>
            </div>
            <span style="color: var(--color-brand-background); font-weight: 700; font-size: 18px;">+</span>
        </div>
    `).join('');
}

function openProfileModal() {
    const profile = state.userProfile;
    document.getElementById('profile-name').value = profile.name;
    document.getElementById('profile-gender').value = profile.gender;
    document.getElementById('profile-age').value = profile.age;
    document.getElementById('profile-weight').value = profile.weight;
    document.getElementById('profile-height').value = profile.height;
    document.getElementById('profile-insulin').value = profile.insulinSensitivity || 'normal';
    document.getElementById('profile-digestion').value = profile.digestionSpeed || 'normal';
    updateBMRPreview();

    ['profile-gender', 'profile-age', 'profile-weight', 'profile-height'].forEach((id) => {
        document.getElementById(id).oninput = updateBMRPreview;
    });

    selectors.profileModal.classList.add('active');
}

function updateBMRPreview() {
    const gender = document.getElementById('profile-gender').value;
    const age = parseInt(document.getElementById('profile-age').value) || 0;
    const weight = parseInt(document.getElementById('profile-weight').value) || 0;
    const height = parseInt(document.getElementById('profile-height').value) || 0;
    const bmr = calculateBMR(weight, height, age, gender);
    document.getElementById('profile-bmr').textContent = `${Math.round(bmr)} kcal/dan`;
}

function calculateBMR(weight, height, age, gender) {
    let bmr = (10 * weight) + (6.25 * height) - (5 * age);
    bmr = gender === 'male' ? bmr + 5 : bmr - 161;
    return bmr;
}

function saveProfile() {
    state.userProfile = {
        name: document.getElementById('profile-name').value,
        gender: document.getElementById('profile-gender').value,
        age: parseInt(document.getElementById('profile-age').value),
        weight: parseInt(document.getElementById('profile-weight').value),
        height: parseInt(document.getElementById('profile-height').value),
        insulinSensitivity: document.getElementById('profile-insulin').value,
        digestionSpeed: document.getElementById('profile-digestion').value
    };
    localStorage.setItem('userProfile', JSON.stringify(state.userProfile));
    updateProfileSummary();
    selectors.profileModal.classList.remove('active');
    if (getCurrentDay()) updateDayAnalysis(getCurrentDay());
}

function updateProfileSummary() {
    selectors.userDisplayName.textContent = state.userProfile.name;
    selectors.userInitials.textContent = state.userProfile.name.split(' ').map((part) => part[0]).join('').toUpperCase();
    const today = state.days.find((day) => day.date === toDayKey(new Date()));
    const todayTotals = today ? calculateDayTotals(today) : { cals: 0 };
    selectors.userDailyStatus.textContent = `Današnji unos: ${Math.round(todayTotals.cals)} kcal`;
}

function updateDayAnalysis(day) {
    if (!day) return;
    renderDaysList();
    renderDayMeals(day);
    const totals = calculateDayTotals(day);
    renderNutritionSummary(day, totals);
    const timeline = buildDayTimeline(day, state.userProfile);
    drawCharts(timeline);
    renderInteractions(day);
    renderRecommendations(day, totals, timeline);
    updateProfileSummary();
}

function calculateMealTotals(meal) {
    const oilGrams = OIL_LEVELS[meal.oilLevel] || 0;
    return meal.ingredients.reduce((acc, ingredient) => {
        const factor = ingredient.amount / 100;
        acc.cals += (ingredient.calories || 0) * factor;
        acc.prot += (ingredient.protein || 0) * factor;
        acc.carb += (ingredient.carbs || 0) * factor;
        acc.fat += (ingredient.fat || 0) * factor;
        acc.sugar += (ingredient.sugar || 0) * factor;
        acc.sat_fat += (ingredient.saturated_fat || 0) * factor;
        acc.fiber += (ingredient.fiber || 0) * factor;
        acc.iron += (ingredient.iron || 0) * factor;
        acc.calcium += (ingredient.calcium || 0) * factor;
        acc.magnesium += (ingredient.magnesium || 0) * factor;
        acc.potassium += (ingredient.potassium || 0) * factor;
        acc.vit_a += (ingredient.vitamin_a || 0) * factor;
        acc.vit_c += (ingredient.vitamin_c || 0) * factor;
        acc.giWeighted += (ingredient.gi || 0) * factor;
        acc.weight += factor;
        return acc;
    }, {
        cals: oilGrams * 9,
        prot: 0,
        carb: 0,
        fat: oilGrams,
        sugar: 0,
        sat_fat: oilGrams * 0.14,
        fiber: 0,
        iron: 0,
        calcium: 0,
        magnesium: 0,
        potassium: 0,
        vit_a: 0,
        vit_c: 0,
        giWeighted: 0,
        weight: 0
    });
}

function calculateDayTotals(day) {
    return day.meals.reduce((acc, meal) => {
        const totals = calculateMealTotals(meal);
        Object.keys(acc).forEach((key) => {
            acc[key] += totals[key] || 0;
        });
        return acc;
    }, {
        cals: 0,
        prot: 0,
        carb: 0,
        fat: 0,
        sugar: 0,
        sat_fat: 0,
        fiber: 0,
        iron: 0,
        calcium: 0,
        magnesium: 0,
        potassium: 0,
        vit_a: 0,
        vit_c: 0,
        giWeighted: 0,
        weight: 0
    });
}

function buildDayTimeline(day, profile) {
    const labels = [];
    const total = [];
    const carbs = [];
    const protein = [];
    const fat = [];
    const wakeHour = parseTimeToHour(day.wakeTime || '07:00');

    for (let offsetHour = 0; offsetHour <= 24; offsetHour += 0.5) {
        labels.push(formatTimelineHour((wakeHour + offsetHour) % 24));
        total.push(0);
        carbs.push(0);
        protein.push(0);
        fat.push(0);
    }

    const context = buildMetabolicContext(day, profile);
    const totals = calculateDayTotals(day);
    const bmr = calculateBMR(profile.weight, profile.height, profile.age, profile.gender);
    const target = bmr * (DAY_ACTIVITY_FACTORS[day.activityLoad] || DAY_ACTIVITY_FACTORS.moderate);
    day.meals.forEach((meal) => {
        const mealCurve = simulateMealCurve(meal, context);
        const relativeHour = normalizeDayHour(getLocalMealHour(meal.timestamp) - wakeHour);
        const offset = Math.round(relativeHour / 0.5);
        mealCurve.energy.total.forEach((value, index) => {
            const targetIndex = offset + index;
            if (targetIndex < 0 || targetIndex >= total.length) return;
            total[targetIndex] += value;
            carbs[targetIndex] += mealCurve.energy.carbs[index];
            protein[targetIndex] += mealCurve.energy.protein[index];
            fat[targetIndex] += mealCurve.energy.fat[index];
        });
    });

    return {
        labels,
        total: total.map((value) => Math.round(value * 10) / 10),
        carbs: carbs.map((value) => Math.round(value * 10) / 10),
        protein: protein.map((value) => Math.round(value * 10) / 10),
        fat: fat.map((value) => Math.round(value * 10) / 10),
        meta: {
            intakeKcal: Math.round(totals.cals),
            targetKcal: Math.round(target),
            deficitKcal: Math.round(target - totals.cals),
            wakeTime: day.wakeTime || '07:00',
            averageHourlyExpenditure: target / 24
        }
    };
}

function buildMetabolicContext(day, profile) {
    const sleepPenalty = clamp(
        Math.max(0, 7 - Number(day.sleepHours || 7)) * MODEL_CONSTANTS.profile.sleepRestrictionPenaltyPerHourUnder7,
        0,
        MODEL_CONSTANTS.profile.maxSleepPenalty
    );
    const activityFactor = DAY_ACTIVITY_FACTORS[day.activityLoad] || DAY_ACTIVITY_FACTORS.moderate;
    const insulinMap = MODEL_CONSTANTS.profile.insulinSensitivity;
    const digestionMap = MODEL_CONSTANTS.profile.digestionSpeed;
    const ageSlowdown = clamp(
        Math.max((profile.age || 30) - 60, 0) * MODEL_CONSTANTS.profile.ageGastricSlowdownPerYearAfter60,
        0,
        MODEL_CONSTANTS.profile.maxAgeGastricSlowdown
    );
    const ageGastricFactor = 1 - ageSlowdown;
    const activityInsulinBoost = MODEL_CONSTANTS.profile.activityInsulinBoost[day.activityLoad] || MODEL_CONSTANTS.profile.activityInsulinBoost.moderate;
    const insulinSensitivity = clamp(
        (insulinMap[profile.insulinSensitivity] || 1) * activityInsulinBoost * (1 - sleepPenalty),
        0.65,
        1.25
    );
    const digestionSpeed = clamp(
        (digestionMap[profile.digestionSpeed] || 1) * clamp(1 - (sleepPenalty * 0.2), 0.9, 1.05),
        0.75,
        1.2
    );

    return {
        insulinSensitivity,
        digestionSpeed,
        activityFactor,
        gastricRate: clamp(ageGastricFactor * digestionSpeed * (1 + ((activityFactor - 1) * 0.04)), 0.72, 1.15),
        absorptionRate: clamp(digestionSpeed * (1 + ((insulinSensitivity - 1) * 0.08)), 0.75, 1.18),
        utilizationRate: clamp((1 + ((insulinSensitivity - 1) * 0.2) + ((activityFactor - 1) * 0.08)), 0.78, 1.16),
        sleepPenalty
    };
}

function simulateMealCurve(meal, context) {
    const totals = calculateMealTotals(meal);
    const avgGi = totals.weight > 0 ? totals.giWeighted / totals.weight : 50;
    const netCarbs = Math.max(0, totals.carb - (totals.fiber * 0.75));
    const sugarRatio = totals.carb > 0 ? clamp(totals.sugar / totals.carb, 0, 1) : 0;
    const totalCals = totals.cals;
    const prep = getPreparationModifiers(meal);
    const gastricBrake = clamp(
        1
        + ((totalCals / 1000) * MODEL_CONSTANTS.gastricEmptying.energySensitivityPer1000Kcal)
        + (totals.fat * prep.fatSlowdown * MODEL_CONSTANTS.gastricEmptying.fatSensitivityPerGram)
        + (totals.fiber * MODEL_CONSTANTS.gastricEmptying.fiberSensitivityPerGram)
        + (totals.prot * MODEL_CONSTANTS.gastricEmptying.proteinSensitivityPerGram),
        1,
        2.4
    );
    const liquidFactor = prep.liquidBias || 1;
    const carbQuality = clamp((avgGi / 100) * 0.55 + sugarRatio * 0.3 + prep.digestibility * 0.25, 0.45, 1.35);
    const horizonHours = clamp(
        MODEL_CONSTANTS.simulation.minHorizonHours + (totalCals / 400) + (totals.fat / 24) + (totals.fiber / 12),
        MODEL_CONSTANTS.simulation.minHorizonHours,
        MODEL_CONSTANTS.simulation.maxHorizonHours
    );

    const carbSeries = simulateMacroCompartment({
        totalKcal: netCarbs * 4,
        gastricHalfLife: clamp((MODEL_CONSTANTS.macros.carbs.gastricHalfLifeHours * gastricBrake) / (context.gastricRate * carbQuality * liquidFactor), 0.45, 2.8),
        absorptionHalfLife: clamp(MODEL_CONSTANTS.macros.carbs.absorptionHalfLifeHours / (context.absorptionRate * carbQuality), 0.35, 1.4),
        utilizationHalfLife: clamp(MODEL_CONSTANTS.macros.carbs.utilizationHalfLifeHours / (context.utilizationRate * context.insulinSensitivity * carbQuality), 0.45, 1.8),
        horizonHours,
        dt: MODEL_CONSTANTS.simulation.dtHours,
        smoothingBias: 0.16
    });

    const proteinSeries = simulateMacroCompartment({
        totalKcal: totals.prot * 4,
        gastricHalfLife: clamp((MODEL_CONSTANTS.macros.protein.gastricHalfLifeHours * gastricBrake) / (context.gastricRate * prep.proteinRate * liquidFactor), 0.8, 3.4),
        absorptionHalfLife: clamp(MODEL_CONSTANTS.macros.protein.absorptionHalfLifeHours / (context.absorptionRate * prep.proteinRate), 0.6, 1.9),
        utilizationHalfLife: clamp(MODEL_CONSTANTS.macros.protein.utilizationHalfLifeHours / context.utilizationRate, 0.8, 2.6),
        horizonHours,
        dt: MODEL_CONSTANTS.simulation.dtHours,
        smoothingBias: 0.12
    });

    const fatSeries = simulateMacroCompartment({
        totalKcal: totals.fat * 9,
        gastricHalfLife: clamp((MODEL_CONSTANTS.macros.fat.gastricHalfLifeHours * gastricBrake * prep.fatSlowdown) / (context.gastricRate * liquidFactor), 1.4, 5.4),
        absorptionHalfLife: clamp(MODEL_CONSTANTS.macros.fat.absorptionHalfLifeHours / (context.absorptionRate * prep.fatRate), 1.1, 3.6),
        utilizationHalfLife: clamp(MODEL_CONSTANTS.macros.fat.utilizationHalfLifeHours / context.utilizationRate, 1.5, 4.2),
        horizonHours,
        dt: MODEL_CONSTANTS.simulation.dtHours,
        smoothingBias: 0.08
    });

    const energy = mergeMacroEnergySeries(carbSeries, proteinSeries, fatSeries);
    return { energy };
}

function getPreparationModifiers(meal) {
    const method = meal.cookingMethod || 'boiled';
    if (method === 'fried') return { digestibility: 0.92, fatSlowdown: 1.24, proteinRate: 0.96, fatRate: 1.08, liquidBias: 1.0 };
    if (method === 'airfried') return { digestibility: 1.0, fatSlowdown: 1.08, proteinRate: 1.01, fatRate: 1.0, liquidBias: 1.0 };
    if (method === 'baked') return { digestibility: 0.98, fatSlowdown: 1.1, proteinRate: 0.99, fatRate: 1.03, liquidBias: 1.0 };
    return { digestibility: 1.0, fatSlowdown: 1.0, proteinRate: 1.0, fatRate: 1.0, liquidBias: 1.0 };
}

function simulateMacroCompartment(config) {
    const dt = config.dt || 0.5;
    const minSteps = Math.round(Math.max((config.horizonHours || 12) * 0.6, 3) / dt);
    const maxSteps = Math.round(clamp((config.horizonHours || 12) * 1.75, 8, 24) / dt);
    const stateSeries = [];
    const displayedSeries = [];
    let stomach = config.totalKcal || 0;
    let gut = 0;
    let available = 0;

    const gastricRate = halfLifeToRate(config.gastricHalfLife);
    const absorptionRate = halfLifeToRate(config.absorptionHalfLife);
    const utilizationRate = halfLifeToRate(config.utilizationHalfLife);
    const smoothingBias = config.smoothingBias || 0.1;
    let smoothedDisplayed = 0;

    for (let step = 0; step <= maxSteps; step++) {
        const emptying = discreteFlow(stomach, gastricRate, dt);
        stomach -= emptying;
        gut += emptying;

        const absorption = discreteFlow(gut, absorptionRate, dt);
        gut -= absorption;
        available += absorption;

        const utilization = discreteFlow(available, utilizationRate, dt);
        available -= utilization;

        const rawDisplayed = (utilization / dt) * (1 - smoothingBias) + ((absorption / dt) * smoothingBias);
        smoothedDisplayed = step === 0
            ? rawDisplayed
            : ((smoothedDisplayed * 0.55) + (rawDisplayed * 0.45));

        displayedSeries.push(Math.max(0, smoothedDisplayed));
        stateSeries.push({ stomach, gut, available });

        const residualEnergy = stomach + gut + available;
        const nearSettled = residualEnergy < MODEL_CONSTANTS.simulation.residualStopKcal && smoothedDisplayed < MODEL_CONSTANTS.simulation.displayedStopKcalPerHour;
        if (step >= minSteps && nearSettled) break;
    }

    const trimmedSeries = trimEnergySeries(displayedSeries, stateSeries);
    return normalizeSeriesArea(trimmedSeries, config.totalKcal || 0, dt);
}

function mergeMacroEnergySeries(carbSeries, proteinSeries, fatSeries) {
    const length = Math.max(carbSeries.length, proteinSeries.length, fatSeries.length);
    const energy = { total: [], carbs: [], protein: [], fat: [] };

    for (let index = 0; index < length; index++) {
        const carbValue = carbSeries[index] || 0;
        const proteinValue = proteinSeries[index] || 0;
        const fatValue = fatSeries[index] || 0;
        energy.carbs.push(carbValue);
        energy.protein.push(proteinValue);
        energy.fat.push(fatValue);
        energy.total.push(carbValue + proteinValue + fatValue);
    }

    return energy;
}

function trimEnergySeries(displaySeries, stateSeries) {
    let lastMeaningfulIndex = displaySeries.length - 1;
    for (let index = displaySeries.length - 1; index >= 0; index--) {
        const value = displaySeries[index] || 0;
        const state = stateSeries[index] || { stomach: 0, gut: 0, available: 0 };
        if (value > 1.2 || (state.stomach + state.gut + state.available) > 3) {
            lastMeaningfulIndex = index;
            break;
        }
    }
    const trimmed = displaySeries.slice(0, Math.max(lastMeaningfulIndex + 3, 2));
    const lastValue = trimmed[trimmed.length - 1] || 0;
    if (lastValue > 0.1) {
        const fadeMultipliers = [0.82, 0.66, 0.52, 0.39, 0.28, 0.18, 0.1, 0.04];
        fadeMultipliers.forEach((multiplier) => {
            trimmed.push(lastValue * multiplier);
        });
        trimmed.push(0);
    }
    return trimmed;
}

function halfLifeToRate(halfLifeHours) {
    return Math.log(2) / Math.max(halfLifeHours, 0.08);
}

function discreteFlow(pool, rate, dt) {
    if (pool <= 0 || rate <= 0) return 0;
    return pool * (1 - Math.exp(-rate * dt));
}

function normalizeSeriesArea(series, targetKcal, dt) {
    if (targetKcal <= 0 || !series.length) return series;
    const currentArea = series.reduce((sum, value) => sum + (value * dt), 0);
    if (currentArea <= 0) return series;
    const scale = targetKcal / currentArea;
    return series.map((value) => value * scale);
}

function drawCharts(timeline) {
    const energyCtx = document.getElementById('energyChart').getContext('2d');
    if (energyChartInstance) energyChartInstance.destroy();
    const energyMax = Math.max(...timeline.total, 40);
    const referenceMax = Math.max((timeline.meta.averageHourlyExpenditure || 0) * 2, 20);
    const chartMax = Math.max(energyMax * 1.1, referenceMax);
    energyChartInstance = new Chart(energyCtx, {
        type: 'line',
        data: {
            labels: timeline.labels,
            datasets: [
                {
                    label: 'Ukupno',
                    data: timeline.total,
                    borderColor: '#0078d4',
                    backgroundColor: 'rgba(0,120,212,0.10)',
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                    borderWidth: 3
                },
                { label: 'UH', data: timeline.carbs, borderColor: '#d83b01', borderDash: [3, 3], pointRadius: 0, borderWidth: 1.4, fill: false },
                { label: 'P', data: timeline.protein, borderColor: '#107c10', borderDash: [3, 3], pointRadius: 0, borderWidth: 1.4, fill: false },
                { label: 'M', data: timeline.fat, borderColor: '#a4262c', borderDash: [3, 3], pointRadius: 0, borderWidth: 1.4, fill: false }
            ]
        },
        options: buildTimelineChartOptions(
            chartMax,
            `Unos: ${timeline.meta.intakeKcal} kcal`,
            `Deficit/suficit: ${formatDeficitLabel(timeline.meta.deficitKcal)} · Buđenje: ${timeline.meta.wakeTime}`
        )
    });
}

function buildTimelineChartOptions(maxY, titleText, subtitleText) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            title: titleText ? {
                display: true,
                text: titleText,
                align: 'start',
                color: '#616161',
                font: { size: 11, weight: '600' },
                padding: { bottom: 4 }
            } : undefined,
            subtitle: subtitleText ? {
                display: true,
                text: subtitleText,
                align: 'start',
                color: subtitleText.includes('-') ? '#107c10' : '#a4262c',
                font: { size: 11, weight: '700' },
                padding: { bottom: 6 }
            } : undefined
        },
        scales: {
            y: {
                display: true,
                min: 0,
                max: Math.max(maxY, 20),
                grid: { color: 'rgba(0, 0, 0, 0.08)' },
                ticks: {
                    color: '#616161',
                    font: { size: 10, weight: '600' },
                    callback: function (value) {
                        return `${Math.round(value)}`;
                    }
                },
                title: {
                    display: true,
                    text: 'kcal/h',
                    color: '#616161',
                    font: { size: 10, weight: '700' }
                }
            },
            x: {
                grid: { display: false },
                ticks: {
                    font: { size: 10, weight: '700' },
                    callback: function (value, index) {
                        return index % 4 === 0 ? this.getLabelForValue(value) : '';
                    }
                }
            }
        }
    };
}

function renderNutritionSummary(day, totals) {
    const bmr = calculateBMR(state.userProfile.weight, state.userProfile.height, state.userProfile.age, state.userProfile.gender);
    const dailyTarget = bmr * (DAY_ACTIVITY_FACTORS[day.activityLoad] || 1.18);
    const macros = [
        { l: 'Energija', v: `${Math.round(totals.cals)} kcal`, p: (totals.cals / dailyTarget) * 100, c: '#0078d4' },
        { l: 'Proteini', v: `${Math.round(totals.prot)} g`, p: (totals.prot / 90) * 100, c: '#107c10' },
        { l: 'Neto ugljikohidrati', v: `${Math.round(totals.carb - totals.fiber)} g`, p: (totals.carb / 250) * 100, c: '#d83b01' },
        { l: 'Masti', v: `${Math.round(totals.fat)} g`, p: (totals.fat / 70) * 100, c: '#a4262c' }
    ];
    const micros = [
        { l: 'Ukupni šećeri', v: `${totals.sugar.toFixed(1)} g`, w: totals.sugar > 65 },
        { l: 'Zasićene masti', v: `${totals.sat_fat.toFixed(1)} g`, w: totals.sat_fat > 20 },
        { l: 'Prehrambena vlakna', v: `${Math.round(totals.fiber)} g` },
        { l: 'Željezo', v: `${totals.iron.toFixed(1)} mg` }
    ];
    const vitamins = [
        { l: 'Vitamin C', v: `${Math.round(totals.vit_c)} mg`, p: (totals.vit_c / 90) * 100 },
        { l: 'Vitamin A', v: `${Math.round(totals.vit_a)} µg`, p: (totals.vit_a / 900) * 100 },
        { l: 'Kalij', v: `${Math.round(totals.potassium)} mg`, p: (totals.potassium / 3500) * 100 },
        { l: 'Magnezij', v: `${Math.round(totals.magnesium)} mg`, p: (totals.magnesium / 400) * 100 },
        { l: 'Kalcij', v: `${Math.round(totals.calcium)} mg`, p: (totals.calcium / 1000) * 100 }
    ].sort((a, b) => a.l.localeCompare(b.l, 'hr'));

    selectors.nutritionData.innerHTML = `
        <div style="font-size: 12px; color: var(--color-neutral-foreground-3); margin-bottom: 12px;">San: ${day.sleepHours} h · Aktivnost: ${formatActivityLabel(day.activityLoad)} · Obroci: ${day.meals.length}</div>
        <div class="macro-section">${macros.map((item) => `<div class="nutrient-card"><div class="nutrient-info"><span class="label">${item.l}</span><span class="value">${item.v}</span></div><div class="progress-bar"><div class="progress" style="width: ${Math.min(item.p, 100)}%; background: ${item.c}"></div></div></div>`).join('')}</div>
        <div class="micro-section" style="margin-top: 24px;"><h4 style="font-size: 11px; text-transform: uppercase; color: var(--color-neutral-foreground-3); margin-bottom: 12px; letter-spacing: 0.5px;">Detaljna razrada</h4><div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">${micros.map((item) => `<div class="micro-card" style="background: white; border: 1px solid var(--color-neutral-stroke-2); padding: 12px; border-radius: 4px; border-left: 3px solid ${item.w ? 'var(--color-error)' : 'var(--color-neutral-stroke-2)'};"><div style="font-size: 10px; font-weight: 600; color: var(--color-neutral-foreground-3); text-transform: uppercase;">${item.l}</div><div style="font-size: 14px; font-weight: 700; color: ${item.w ? 'var(--color-error)' : 'var(--color-neutral-foreground-1)'};">${item.v}</div></div>`).join('')}</div></div>
        <div class="vitamins-section" style="margin-top: 24px;"><h4 style="font-size: 11px; text-transform: uppercase; color: var(--color-neutral-foreground-3); margin-bottom: 12px; letter-spacing: 0.5px;">Vitamini i minerali</h4><div style="display: grid; grid-template-columns: 1fr; gap: 12px;">${vitamins.map((item) => `<div style="display: flex; flex-direction: column; gap: 4px;"><div style="display: flex; justify-content: space-between; font-size: 12px;"><span style="color: var(--color-neutral-foreground-2); font-weight: 500;">${item.l}</span><span style="color: var(--color-neutral-foreground-1); font-weight: 700;">${item.v}</span></div><div style="height: 3px; background: var(--color-neutral-background-3); border-radius: 2px;"><div style="height: 100%; width: ${Math.min(item.p, 100)}%; background: #0078d4; border-radius: 2px;"></div></div></div>`).join('')}</div></div>
    `;
}

function renderInteractions(day) {
    const items = day.meals.flatMap((meal) => meal.ingredients
        .filter((ingredient) => ingredient.interaction)
        .map((ingredient) => ({ meal, ingredient })));

    selectors.interactionsList.innerHTML = items.length
        ? items.map((item) => `<div class="interaction-pill"><span class="food">${formatTime(item.meal.timestamp)} · ${item.ingredient.name}</span>: ${item.ingredient.interaction}</div>`).join('')
        : '<p class="placeholder-text" style="color: var(--color-neutral-foreground-3); font-size: 12px; font-style: italic;">Dodaj obroke i namirnice za pregled interakcija kroz dan.</p>';
}

function renderRecommendations(day, totals, timeline) {
    const items = [];
    const peakCarbRelease = Math.max(...(timeline.carbs || [0]));
    if (day.sleepHours < 7) items.push('Manjak sna može pojačati dnevne oscilacije energije i glukoze. Ako graf djeluje preoštro, prvo korigiraj san.');
    if (day.activityLoad === 'rest' && totals.carb > 180) items.push('Dan s vrlo malo aktivnosti i više ugljikohidrata često daje viši inzulinski teret kroz dan.');
    if (totals.fiber < 25) items.push('Dnevna vlakna su niska. Više povrća, mahunarki ili zobenih pahuljica obično smiruje profil energije.');
    if (totals.prot < 70) items.push('Dnevni unos proteina je nizak. Veći unos proteina često daje stabilniju sitost i blaži pad energije.');
    if (peakCarbRelease > 55) items.push('Dan ima izraženiji ugljikohidratni vrh. Pomoći mogu više vlakana, manje tekućih šećera i niži GI u najjačem obroku.');
    if (day.meals.some((meal) => meal.cookingMethod === 'fried' || meal.oilLevel === 'high')) items.push('Prženje i više ulja produljuju energijski rep obroka i dižu kalorijsku gustoću dana.');
    if (!items.length) items.push('Profil dana izgleda relativno uravnoteženo. Za još bolju procjenu fino namjesti san, aktivnost i probavu u profilu.');

    selectors.recommendationsList.innerHTML = items.map((item) => `<li>${item}</li>`).join('');
}

function getCurrentDay() {
    return state.days.find((day) => day.id === state.currentDayId);
}

function getCurrentMeal() {
    const day = getCurrentDay();
    if (!day) return null;
    return day.meals.find((meal) => meal.id === state.currentMealId) || null;
}

function saveState() {
    localStorage.setItem('days', JSON.stringify(state.days));
}

function showEmptyState() {
    selectors.emptyState.classList.remove('hidden');
    selectors.dayContent.classList.add('hidden');
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function toDayKey(dateLike) {
    const date = new Date(dateLike);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function toLocalDateTimeValue(isoString) {
    const date = new Date(isoString);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formatDayLabel(dayKey) {
    const day = new Date(`${dayKey}T12:00:00`);
    const today = toDayKey(new Date());
    const yesterday = toDayKey(Date.now() - 86400000);
    if (dayKey === today) return 'Danas';
    if (dayKey === yesterday) return 'Jučer';
    return day.toLocaleDateString('hr-HR', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(isoString) {
    return new Date(isoString).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
}

function formatTimelineHour(hour) {
    const h = Math.floor(hour);
    const m = hour % 1 === 0 ? '00' : '30';
    return `${String(h).padStart(2, '0')}:${m}`;
}

function parseTimeToHour(timeString) {
    const [hours, minutes] = (timeString || '07:00').split(':').map(Number);
    return (hours || 0) + ((minutes || 0) / 60);
}

function normalizeDayHour(hour) {
    if (hour < 0) return hour + 24;
    if (hour >= 24) return hour - 24;
    return hour;
}

function getLocalMealHour(timestamp) {
    const date = new Date(timestamp);
    return date.getHours() + (date.getMinutes() / 60);
}

function formatActivityLabel(value) {
    return {
        rest: 'vrlo niska',
        light: 'lagana',
        moderate: 'umjerena',
        high: 'visoka',
        intense: 'vrlo visoka'
    }[value] || 'umjerena';
}

function formatDeficitLabel(deficitKcal) {
    if (deficitKcal >= 0) return `-${deficitKcal} kcal`;
    return `+${Math.abs(deficitKcal)} kcal`;
}
