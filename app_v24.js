const DEFAULT_PROFILE = {
    name: 'Korisnik',
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
    // ── Literature anchors ──
    // Carbohydrate absorption:
    //   - Healthy postprandial glucose peaks ~30-60 min, baseline by 2-3 h (PMC6781941)
    //   - Real-world CGM mean time-to-peak glucose: 46 min (IQR 30-72 min) (PMC8120054)
    //   - Gastric emptying T50 mixed meal: 30-105 min (PMC10078504)
    // Protein absorption:
    //   - Whey protein absorption rate ~8-10 g/h, casein slower (PMC5828430)
    //   - Mixed-meal protein: peak amino acids ~60-120 min (PMC3644706)
    // Fat absorption:
    //   - Postprandial triglycerides peak ~3-4 h, baseline over 6-8 h (PMC7014867)
    //   - Lipid absorption requires bile/lipase; slower gastric emptying (PMC6627312)
    // Sleep & activity:
    //   - Partial sleep deprivation → ~22% reduced insulin sensitivity (PMC5123208)
    //   - Exercise training → ~11-15% improved insulin sensitivity (PMC3920903)
    //   - Ageing slows gastric emptying ~20% after 60 (PMC4666943)
    //
    // Model: Gamma-distribution absorption curves
    //   Energy(t) = totalKcal * gamma_pdf(t; k, θ)
    //   where k = shape (controls peak sharpness), θ = scale (controls time-to-peak)
    //   Peak occurs at t = (k-1)*θ for k > 1
    //
    macros: {
        carbs: {
            // Peak at ~0.75h (45 min). k=3.0, θ=0.375 → peak=(3-1)*0.375=0.75h
            // Duration ~3-4h for complete absorption
            shapeK: 3.0,
            scaleTheta: 0.375,
            durationHours: 4.0
        },
        protein: {
            // Peak at ~1.5h (90 min). k=3.0, θ=0.75 → peak=(3-1)*0.75=1.5h
            // Duration ~5-6h
            shapeK: 3.0,
            scaleTheta: 0.75,
            durationHours: 6.0
        },
        fat: {
            // Peak at ~3.0h. k=2.5, θ=2.0 → peak=(2.5-1)*2.0=3.0h
            // Duration ~8-10h
            shapeK: 2.5,
            scaleTheta: 2.0,
            durationHours: 10.0
        }
    },
    // Gastric emptying modifiers: slow down absorption based on meal composition
    gastricBrake: {
        energySensitivityPer1000Kcal: 0.25,
        fatSensitivityPerGram: 0.008,
        fiberSensitivityPerGram: 0.012,
        proteinSensitivityPerGram: 0.003
    },
    profile: {
        insulinSensitivity: {
            low: 0.85,
            normal: 1.0,
            high: 1.15
        },
        digestionSpeed: {
            slow: 0.82,
            normal: 1.0,
            fast: 1.18
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
    // Circadian rhythm of insulin sensitivity
    // Insulin sensitivity is highest in the morning and lowest in the evening
    // ~30-50% reduction from morning to evening (PMC5765913)
    circadian: {
        // Cosine model: peak at peakHour, trough 12h later
        peakHour: 8,      // 8:00 AM = highest insulin sensitivity
        amplitude: 0.25   // ±25% variation from mean
    },
    // Thermic Effect of Food — energy cost of digesting each macro
    // (PMC4258944)
    tef: {
        protein: 0.25,    // 20-30% of protein calories lost to digestion
        carbs: 0.075,     // 5-10%
        fat: 0.02         // 0-3%
    },
    // Second Meal Effect — high-fiber/legume meal reduces glycemic
    // response of the next meal (PMC3862063, PMC4192822)
    secondMealEffect: {
        maxReduction: 0.25, // up to 25% peak reduction of next meal's carb curve
        fiberThresholdGrams: 8,   // minimum fiber in previous meal to trigger
        decayHalfLifeHours: 4,    // effect halves every 4 hours
        maxGapHours: 8            // effect disappears after 8 hours
    },
    // Soluble fiber categories — foods in these categories get an extra
    // gastric-slowing bonus because they contain more soluble (gel-forming) fiber
    solubleFiberCategories: ['mahunarke', 'žitarice', '\u017eitarice'],
    solubleFiberBonusPerGram: 0.02,  // extra brake per gram fiber from these categories
    // Resistant starch — boiled+cooled starchy foods form retrograded starch
    resistantStarchFoods: ['krumpir kuhani', 'batat', 'riža bijela kuhana', 'riža smeđa kuhana'],
    resistantStarchFraction: 0.12,  // ~12% of starch becomes resistant after cooling
    // Acid modifiers — vinegar, lemon juice slow gastric emptying
    acidFoods: ['ocat', 'jabučni ocat', 'limun', 'limunov sok'],
    acidGastricSlowdown: 0.15,  // 15% slower gastric emptying
    // Exercise effects
    exerciseEffects: {
        epocFraction: 0.15, // 15% of activity calories expended post-workout
        epocDurationHours: 3.0, // spread over 3 hours
        glut4PeakBoost: 0.40, // +40% insulin sensitivity immediately after
        glut4DecayHalfLifeHours: 6.0,
        sympatheticSlowingMax: 0.35, // max 35% slower digestion during/just before
        preExerciseWindowHours: 1.5 // begins 1.5 hours before training
    },
    simulation: {
        dtHours: 0.25  // 15-minute resolution for smoother curves
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
    addActivityBtn: document.getElementById('add-activity-btn'),
    dayActivitiesList: document.getElementById('day-activities-list'),
    dayActivityCount: document.getElementById('day-activity-count'),
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
                activities: day.activities || [],
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
                activities: [],
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
    if (selectors.addActivityBtn) selectors.addActivityBtn.onclick = createNewActivity;
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

    renderDayActivities(day);
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

function createNewActivity() {
    const day = getCurrentDay();
    if (!day) return;
    day.activities = day.activities || [];
    const dateStr = day.date || toDayKey(new Date());
    day.activities.push({
        id: Date.now().toString(),
        name: 'Trening',
        timestamp: `${dateStr}T18:00:00.000Z`,
        durationMinutes: 45,
        calories: 300
    });
    saveState();
    renderDayActivities(day);
    updateDayAnalysis(day);
}

function updateActivityField(id, field, value) {
    const day = getCurrentDay();
    if (!day) return;
    const activity = day.activities.find(a => a.id === id);
    if (!activity) return;
    if (field === 'timestamp') {
        activity.timestamp = new Date(value).toISOString();
    } else {
        activity[field] = value;
    }
    saveState();
    renderDayActivities(day);
    updateDayAnalysis(day);
}

function removeActivity(id) {
    const day = getCurrentDay();
    if (!day) return;
    day.activities = day.activities.filter(a => a.id !== id);
    saveState();
    renderDayActivities(day);
    updateDayAnalysis(day);
}

function renderDayActivities(day) {
    if (!selectors.dayActivityCount) return;
    day.activities = day.activities || [];
    selectors.dayActivityCount.textContent = `${day.activities.length} aktivnosti`;
    
    if (!day.activities.length) {
        selectors.dayActivitiesList.innerHTML = '<div style="padding: 14px; border: 1px dashed var(--color-neutral-stroke-1); border-radius: 8px; color: var(--color-neutral-foreground-3); font-size: 13px;">Nema dodatnih aktivnosti za ovaj dan.</div>';
        return;
    }

    selectors.dayActivitiesList.innerHTML = [...day.activities]
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .map((activity) => {
            return `
                <div class="meal-item meal-row-compact" style="flex-wrap: wrap; gap: 8px;">
                    <div style="flex: 1 1 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <input type="text" value="${activity.name}" onchange="updateActivityField('${activity.id}', 'name', this.value)" style="border: none; background: transparent; font-weight: 600; font-size: 13px; color: var(--color-neutral-foreground-1); outline: none; width: 100%;">
                        <button onclick="removeActivity('${activity.id}')" class="icon-btn" style="color: var(--color-error); padding: 0 4px;">×</button>
                    </div>
                    <div style="display: flex; gap: 8px; width: 100%; align-items: center;">
                        <input type="datetime-local" value="${toLocalDateTimeValue(activity.timestamp)}" onchange="updateActivityField('${activity.id}', 'timestamp', this.value)" style="flex: 1; border: 1px solid var(--color-neutral-stroke-1); border-radius: 4px; padding: 4px 8px; font-size: 11px; height: 28px; width: 120px;">
                        <div style="display: flex; align-items: center; border: 1px solid var(--color-neutral-stroke-1); border-radius: 4px; padding: 0 4px; height: 28px;">
                            <input type="number" value="${activity.durationMinutes}" min="1" max="600" onchange="updateActivityField('${activity.id}', 'durationMinutes', Number(this.value))" style="width: 32px; border: none; text-align: right; background: transparent; font-size: 12px; outline: none;">
                            <span style="font-size: 11px; padding: 0 4px 0 2px; color: var(--color-neutral-foreground-3);">min</span>
                        </div>
                        <div style="display: flex; align-items: center; border: 1px solid var(--color-neutral-stroke-1); border-radius: 4px; padding: 0 4px; height: 28px;">
                            <input type="number" value="${activity.calories}" min="1" max="5000" onchange="updateActivityField('${activity.id}', 'calories', Number(this.value))" style="width: 38px; border: none; text-align: right; background: transparent; font-size: 12px; outline: none;">
                            <span style="font-size: 11px; padding: 0 4px 0 2px; color: var(--color-neutral-foreground-3);">kcal</span>
                        </div>
                    </div>
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
    const dt = MODEL_CONSTANTS.simulation.dtHours; // 0.25h = 15 min
    const totalSlots = Math.round(24 / dt) + 1;

    for (let i = 0; i < totalSlots; i++) {
        const offsetHour = i * dt;
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

    // Sort meals chronologically for second-meal-effect
    const sortedMeals = [...day.meals].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    let previousMealInfo = null;
    let totalTefLoss = 0;

    sortedMeals.forEach((meal) => {
        const mealHour = getLocalMealHour(meal.timestamp);
        const mealCurve = simulateMealCurve(meal, context, mealHour, previousMealInfo, day.activities || []);
        const relativeHour = normalizeDayHour(mealHour - wakeHour);
        const offset = Math.round(relativeHour / dt);
        mealCurve.energy.total.forEach((value, index) => {
            const targetIndex = offset + index;
            if (targetIndex < 0 || targetIndex >= total.length) return;
            total[targetIndex] += value;
            carbs[targetIndex] += mealCurve.energy.carbs[index];
            protein[targetIndex] += mealCurve.energy.protein[index];
            fat[targetIndex] += mealCurve.energy.fat[index];
        });

        totalTefLoss += mealCurve.meta.tefLoss || 0;

        // Store this meal's info for second-meal-effect on next meal
        const mealTotals = calculateMealTotals(meal);
        previousMealInfo = {
            hour: mealHour,
            fiber: mealTotals.fiber,
            hasLegumes: meal.ingredients.some(ing =>
                (ing.category || '').toLowerCase().includes('mahunark')
            ),
            hasSolubleFiber: meal.ingredients.some(ing =>
                MODEL_CONSTANTS.solubleFiberCategories.some(cat =>
                    normalizeText(ing.category || '').includes(normalizeText(cat))
                )
            )
        };
    });

    // ── Build variable expenditure line (sleep vs awake) ──
    // Sleep metabolic rate ≈ 0.9 * BMR (PMC3619301)
    // Waking rate adjusted so 24h total = TDEE
    const sleepHours = clamp(Number(day.sleepHours) || 8, 0, 16);
    const bmrPerHour = bmr / 24;
    const sleepRate = bmrPerHour * 0.9;
    const wakeHours = 24 - sleepHours;
    // Distribute: sleepHours * sleepRate + wakeHours * wakeRate = TDEE
    const wakeRate = wakeHours > 0 ? (target - sleepHours * sleepRate) / wakeHours : target / 24;
    // Bedtime: wake_time - sleep_hours (wrapped around 24h)
    const bedHour = normalizeDayHour(wakeHour - sleepHours + 24);
    // Pre-compute relative sleep window (relative to wake)
    const sleepStartOffset = normalizeDayHour(bedHour - wakeHour + 24);  // hours after wake until bed
    // Smooth sigmoid transition (~30 min ramp)
    const transitionWidth = 0.5; // hours
    const expenditure = [];
    for (let i = 0; i < totalSlots; i++) {
        const offsetH = i * dt;
        // Determine if this slot is in sleep or wake zone
        // Sleep zone: from sleepStartOffset to 24 (end of timeline)
        // and from 0 to 0 (wake=start of timeline by definition)
        // Since timeline starts at wake, sleep is at the end: sleepStartOffset..24
        const distToSleepStart = offsetH - sleepStartOffset;
        const distToWake = offsetH; // distance from wake (timeline start)
        // Sigmoid: 0=awake, 1=asleep
        let sleepFraction;
        if (sleepHours <= 0) {
            sleepFraction = 0;
        } else if (sleepHours >= 24) {
            sleepFraction = 1;
        } else {
            // Going to sleep transition (sigmoid rising around sleepStartOffset)
            const fallAsleep = 1 / (1 + Math.exp(-10 * (distToSleepStart / transitionWidth)));
            // Waking up transition (sigmoid falling around 0 / 24)
            // For the waking transition, we need to handle the wrap:
            // At the very start of timeline (offsetH~0), person just woke up (awake)
            // At the very end (offsetH~24), person is about to wake (still asleep near end)
            const wakeUpProgress = offsetH < sleepHours * 0.5
                ? 0  // clearly just woke, no sleep fraction from "wrapping"
                : fallAsleep;
            sleepFraction = clamp(wakeUpProgress, 0, 1);
        }
        const rate = sleepRate * sleepFraction + wakeRate * (1 - sleepFraction);
        expenditure.push(Math.round(rate * 10) / 10);
    }

    // Add explicit activities spikes to expenditure
    let totalActivityKcal = 0;
    const activities = day.activities || [];
    activities.forEach(activity => {
        const kcal = Number(activity.calories) || 0;
        totalActivityKcal += kcal;
        const actHour = getLocalMealHour(activity.timestamp);
        const relativeHour = normalizeDayHour(actHour - wakeHour);
        const startOffset = Math.round(relativeHour / dt);
        const durationH = Math.max(0.1, (Number(activity.durationMinutes) || 0) / 60);
        const slotsCount = Math.max(1, Math.round(durationH / dt));
        const rateToAdd = kcal / durationH;
        
        for (let i = 0; i < slotsCount; i++) {
            const targetIndex = startOffset + i;
            if (targetIndex >= 0 && targetIndex < expenditure.length) {
                expenditure[targetIndex] = Math.round((expenditure[targetIndex] + rateToAdd) * 10) / 10;
            }
        }

        // EPOC (Afterburn effect): 15% of calories spread smoothly over 3 hours
        const epocKcal = kcal * MODEL_CONSTANTS.exerciseEffects.epocFraction;
        const epocDurationH = MODEL_CONSTANTS.exerciseEffects.epocDurationHours;
        const epocSlots = Math.round(epocDurationH / dt);
        const epocEndOffset = startOffset + slotsCount;
        for (let i = 0; i < epocSlots; i++) {
            const targetIndex = epocEndOffset + i;
            if (targetIndex >= 0 && targetIndex < expenditure.length) {
                // Exponential decay of EPOC rate
                const fraction = Math.exp(-3 * (i / epocSlots)); // decays smoothly
                const epocRate = (epocKcal / epocDurationH) * fraction * 1.5; // normalization
                expenditure[targetIndex] = Math.round((expenditure[targetIndex] + epocRate) * 10) / 10;
            }
        }
    });

    const finalTargetKcal = Math.round(target + totalActivityKcal);

    return {
        labels,
        total: total.map((value) => Math.round(value * 10) / 10),
        carbs: carbs.map((value) => Math.round(value * 10) / 10),
        protein: protein.map((value) => Math.round(value * 10) / 10),
        fat: fat.map((value) => Math.round(value * 10) / 10),
        expenditure,
        meta: {
            intakeKcal: Math.round(totals.cals),
            targetKcal: finalTargetKcal,
            deficitKcal: Math.round(finalTargetKcal - totals.cals),
            wakeTime: day.wakeTime || '07:00',
            bedTime: formatTimelineHour(bedHour),
            sleepRate: Math.round(sleepRate * 10) / 10,
            wakeRate: Math.round(wakeRate * 10) / 10,
            averageHourlyExpenditure: target / 24,
            tefLossKcal: Math.round(totalTefLoss),
            totalActivityKcal
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
    const digestionSpeed = clamp(
        (digestionMap[profile.digestionSpeed] || 1) * clamp(1 - (sleepPenalty * 0.2), 0.9, 1.05),
        0.75,
        1.2
    );

    return {
        insulinSensitivity: clamp(
            (insulinMap[profile.insulinSensitivity] || 1) * activityInsulinBoost * (1 - sleepPenalty),
            0.65, 1.45
        ),
        digestionSpeed,
        activityFactor,
        gastricRate: clamp(ageGastricFactor * digestionSpeed * (1 + ((activityFactor - 1) * 0.04)), 0.72, 1.25),
        sleepPenalty
    };
}

function simulateMealCurve(meal, context, mealHour, previousMealInfo, activities = []) {
    const totals = calculateMealTotals(meal);
    const sugarRatio = totals.carb > 0 ? clamp(totals.sugar / totals.carb, 0, 1) : 0;
    const totalCals = totals.cals;
    const prep = getPreparationModifiers(meal);
    const dt = MODEL_CONSTANTS.simulation.dtHours;
    const hour = mealHour !== undefined ? mealHour : 12;

    // ── Per-ingredient carb-weighted GI (more accurate than weight-based) ──
    let carbWeightedGiSum = 0;
    let totalCarbGrams = 0;
    meal.ingredients.forEach(ing => {
        const factor = (ing.amount || 100) / 100;
        const carbG = (ing.carbs || 0) * factor;
        carbWeightedGiSum += (ing.gi || 0) * carbG;
        totalCarbGrams += carbG;
    });
    const avgGi = totalCarbGrams > 0 ? carbWeightedGiSum / totalCarbGrams : 50;

    // ── Soluble fiber bonus ──
    // Foods from legume/grain categories have more soluble (gel-forming) fiber
    let solubleFiberGrams = 0;
    meal.ingredients.forEach(ing => {
        const factor = (ing.amount || 100) / 100;
        const cat = normalizeText(ing.category || '');
        const isSoluble = MODEL_CONSTANTS.solubleFiberCategories.some(c =>
            cat.includes(normalizeText(c))
        );
        if (isSoluble) solubleFiberGrams += (ing.fiber || 0) * factor;
    });

    // ── Resistant starch detection ──
    let resistantStarchCarbs = 0;
    if (meal.cookingMethod === 'boiled') {
        meal.ingredients.forEach(ing => {
            const nameLower = (ing.name || '').toLowerCase();
            const isResistant = MODEL_CONSTANTS.resistantStarchFoods.some(f =>
                nameLower.includes(f.toLowerCase())
            );
            if (isResistant) {
                const factor = (ing.amount || 100) / 100;
                resistantStarchCarbs += (ing.carbs || 0) * factor * MODEL_CONSTANTS.resistantStarchFraction;
            }
        });
    }

    // ── Acid modifier (vinegar, lemon) ──
    const hasAcid = meal.ingredients.some(ing =>
        MODEL_CONSTANTS.acidFoods.some(a =>
            normalizeText(ing.name || '').includes(normalizeText(a))
        )
    );

    const netCarbs = Math.max(0, totals.carb - (totals.fiber * 0.75) - resistantStarchCarbs);

    // ── Thermic Effect of Food (TEF) ──
    // Net available energy = gross energy - energy used for digestion
    const tefConstants = MODEL_CONSTANTS.tef;
    const netCarbKcal = netCarbs * 4 * (1 - tefConstants.carbs);
    const netProtKcal = totals.prot * 4 * (1 - tefConstants.protein);
    const netFatKcal = totals.fat * 9 * (1 - tefConstants.fat);

    // ── Circadian & Exercise modulation ──
    const circ = MODEL_CONSTANTS.circadian;
    const circadianFactor = 1 + circ.amplitude * Math.cos(2 * Math.PI * (hour - circ.peakHour) / 24);

    let glut4Boost = 0;
    let sympatheticSlowing = 0;

    if (activities && activities.length > 0) {
        activities.forEach(act => {
            const actHour = getLocalMealHour(act.timestamp);
            const durationH = Math.max(0.1, (Number(act.durationMinutes) || 0) / 60);
            const actEndHour = actHour + durationH;
            
            // Post-exercise GLUT-4 insulin sensitivity boost
            const gap = normalizeDayHour(hour - actEndHour);
            // If gap is between 0 and 16 hours after end of activity
            if (gap >= 0 && gap < 16) {
                const decay = Math.exp(-Math.log(2) * gap / MODEL_CONSTANTS.exerciseEffects.glut4DecayHalfLifeHours);
                glut4Boost = Math.max(glut4Boost, MODEL_CONSTANTS.exerciseEffects.glut4PeakBoost * decay);
            }
            
            // Pre-exercise/During Exercise sympathetic gastric slowing
            const preWindow = MODEL_CONSTANTS.exerciseEffects.preExerciseWindowHours;
            // E.g. meal at 17:00, act at 18:00
            const priorGap = normalizeDayHour(actEndHour - hour);
            if (priorGap >= 0 && priorGap <= durationH + preWindow) {
                const intensity = (Number(act.calories) || 300) / durationH;
                const intensityFactor = clamp(intensity / 400, 0.5, 1.2);
                sympatheticSlowing = Math.max(sympatheticSlowing, MODEL_CONSTANTS.exerciseEffects.sympatheticSlowingMax * intensityFactor);
            }
        });
    }

    const effectiveInsulinSensitivity = context.insulinSensitivity * (1 + glut4Boost);
    const effectiveGastricRate = context.gastricRate * (1 - sympatheticSlowing);

    // ── Second meal effect ──
    let secondMealReduction = 0;
    if (previousMealInfo) {
        const sme = MODEL_CONSTANTS.secondMealEffect;
        const gapHours = normalizeDayHour(hour - previousMealInfo.hour);
        if (gapHours > 0 && gapHours <= sme.maxGapHours && previousMealInfo.fiber >= sme.fiberThresholdGrams) {
            const fiberStrength = clamp((previousMealInfo.fiber - sme.fiberThresholdGrams) / 12, 0, 1);
            const legumeBonus = previousMealInfo.hasLegumes ? 1.4 : 1.0;
            const decay = Math.exp(-Math.log(2) * gapHours / sme.decayHalfLifeHours);
            secondMealReduction = clamp(sme.maxReduction * fiberStrength * legumeBonus * decay, 0, sme.maxReduction);
        }
    }

    // Gastric brake: high-calorie, high-fat, high-fiber meals slow absorption
    const gastricBrake = clamp(
        1
        + ((totalCals / 1000) * MODEL_CONSTANTS.gastricBrake.energySensitivityPer1000Kcal)
        + (totals.fat * prep.fatSlowdown * MODEL_CONSTANTS.gastricBrake.fatSensitivityPerGram)
        + (totals.fiber * MODEL_CONSTANTS.gastricBrake.fiberSensitivityPerGram)
        + (totals.prot * MODEL_CONSTANTS.gastricBrake.proteinSensitivityPerGram)
        + (solubleFiberGrams * MODEL_CONSTANTS.solubleFiberBonusPerGram)
        + (hasAcid ? MODEL_CONSTANTS.acidGastricSlowdown : 0),
        1,
        2.2
    );

    // GI and sugar affect carb absorption speed
    const carbSpeedFactor = clamp(
        ((avgGi / 50) * 0.4 + sugarRatio * 0.25 + prep.digestibility * 0.35) * effectiveInsulinSensitivity,
        0.5, 2.0
    );

    // Context modifiers: digestion speed, age, circadian, sympathetic branch
    const contextSpeedInverse = gastricBrake / (effectiveGastricRate * circadianFactor);

    // ── Carbs: gamma curve (with second-meal-effect reduction) ──
    const carbConfig = MODEL_CONSTANTS.macros.carbs;
    const carbTheta = (carbConfig.scaleTheta * contextSpeedInverse) / carbSpeedFactor;
    const effectiveCarbKcal = netCarbKcal * (1 - secondMealReduction);
    const carbSeries = generateGammaCurve({
        totalKcal: effectiveCarbKcal,
        shapeK: carbConfig.shapeK,
        scaleTheta: clamp(carbTheta, 0.15, 1.2),
        durationHours: carbConfig.durationHours * clamp(contextSpeedInverse, 0.8, 1.6),
        dt
    });

    // ── Protein: gamma curve ──
    const protConfig = MODEL_CONSTANTS.macros.protein;
    const protTheta = (protConfig.scaleTheta * contextSpeedInverse) / prep.proteinRate;
    const proteinSeries = generateGammaCurve({
        totalKcal: netProtKcal,
        shapeK: protConfig.shapeK,
        scaleTheta: clamp(protTheta, 0.35, 2.0),
        durationHours: protConfig.durationHours * clamp(contextSpeedInverse, 0.8, 1.5),
        dt
    });

    // ── Fat: gamma curve ──
    const fatConfig = MODEL_CONSTANTS.macros.fat;
    const fatTheta = (fatConfig.scaleTheta * contextSpeedInverse * prep.fatSlowdown) / prep.fatRate;
    const fatSeries = generateGammaCurve({
        totalKcal: netFatKcal,
        shapeK: fatConfig.shapeK,
        scaleTheta: clamp(fatTheta, 1.0, 5.0),
        durationHours: fatConfig.durationHours * clamp(contextSpeedInverse, 0.8, 1.8),
        dt
    });

    const energy = mergeMacroEnergySeries(carbSeries, proteinSeries, fatSeries);
    return { 
        energy, 
        meta: { 
            circadianFactor, 
            secondMealReduction, 
            tefLoss: (totalCals - netCarbKcal - netProtKcal - netFatKcal), 
            resistantStarchCarbs, 
            hasAcid, 
            solubleFiberGrams,
            glut4Boost,
            sympatheticSlowing
        } 
    };
}

function getPreparationModifiers(meal) {
    const method = meal.cookingMethod || 'boiled';
    if (method === 'fried') return { digestibility: 0.92, fatSlowdown: 1.24, proteinRate: 0.96, fatRate: 1.08 };
    if (method === 'airfried') return { digestibility: 1.0, fatSlowdown: 1.08, proteinRate: 1.01, fatRate: 1.0 };
    if (method === 'baked') return { digestibility: 0.98, fatSlowdown: 1.1, proteinRate: 0.99, fatRate: 1.03 };
    return { digestibility: 1.0, fatSlowdown: 1.0, proteinRate: 1.0, fatRate: 1.0 };
}

// ── Gamma-distribution energy curve ──
// Uses the gamma PDF: f(t) = t^(k-1) * exp(-t/θ) / (θ^k * Γ(k))
// Peak at t = (k-1)*θ for k > 1
// The area under the curve is normalized to totalKcal
// Duration is dynamically extended until the curve drops below 1% of peak
function generateGammaCurve(config) {
    const { totalKcal, shapeK, scaleTheta, durationHours, dt } = config;
    if (totalKcal <= 0) return [];

    const rawSeries = [];

    // Compute gamma PDF values
    const gammaK = gammaFunction(shapeK);
    const normFactor = Math.pow(scaleTheta, shapeK) * gammaK;

    // Peak of gamma PDF occurs at t = (k-1)*θ for k > 1
    const peakTime = Math.max((shapeK - 1) * scaleTheta, dt);
    const peakPdf = Math.pow(peakTime, shapeK - 1) * Math.exp(-peakTime / scaleTheta) / normFactor;
    const tailThreshold = peakPdf * 0.01; // Stop when PDF drops below 1% of peak

    const minSteps = Math.ceil(durationHours / dt);
    const maxSteps = Math.ceil(20 / dt); // Absolute max: 20 hours

    for (let i = 0; i <= maxSteps; i++) {
        const t = i * dt;
        if (t === 0 && shapeK < 1) {
            rawSeries.push(0);
            continue;
        }
        const pdf = t > 0
            ? Math.pow(t, shapeK - 1) * Math.exp(-t / scaleTheta) / normFactor
            : 0;
        rawSeries.push(pdf);

        // After minimum duration, stop when curve has decayed sufficiently
        if (i >= minSteps && pdf < tailThreshold) break;
    }

    // Normalize: scale so total area = totalKcal
    let area = 0;
    for (let i = 0; i < rawSeries.length; i++) {
        area += rawSeries[i] * dt;
    }

    if (area <= 0) return rawSeries.map(() => 0);
    const scale = totalKcal / area;
    return rawSeries.map(v => Math.max(0, v * scale));
}

// Lanczos approximation for Γ(z)
function gammaFunction(z) {
    if (z < 0.5) {
        return Math.PI / (Math.sin(Math.PI * z) * gammaFunction(1 - z));
    }
    z -= 1;
    const g = 7;
    const c = [
        0.99999999999980993,
        676.5203681218851,
        -1259.1392167224028,
        771.32342877765313,
        -176.61502916214059,
        12.507343278686905,
        -0.13857109526572012,
        9.9843695780195716e-6,
        1.5056327351493116e-7
    ];
    let x = c[0];
    for (let i = 1; i < g + 2; i++) {
        x += c[i] / (z + i);
    }
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
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

function drawCharts(timeline) {
    const energyCtx = document.getElementById('energyChart').getContext('2d');
    if (energyChartInstance) energyChartInstance.destroy();
    const energyMax = Math.max(...timeline.total, 40);
    const expenditureMax = Math.max(...(timeline.expenditure || [20]));
    const chartMax = Math.max(expenditureMax * 1.15, energyMax * 1.1);

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
                { label: 'M', data: timeline.fat, borderColor: '#a4262c', borderDash: [3, 3], pointRadius: 0, borderWidth: 1.4, fill: false },
                {
                    label: 'Potrošnja',
                    data: timeline.expenditure,
                    borderColor: '#8661c5',
                    backgroundColor: 'rgba(134,97,197,0.06)',
                    borderDash: [6, 4],
                    pointRadius: 0,
                    borderWidth: 1.8,
                    fill: true,
                    tension: 0.3
                }
            ]
        },
        options: buildTimelineChartOptions(
            chartMax,
            `Unos: ${timeline.meta.intakeKcal} kcal · TEF: ~${timeline.meta.tefLossKcal || 0} kcal`,
            `Deficit/suficit: ${formatDeficitLabel(timeline.meta.deficitKcal)} · Buđenje: ${timeline.meta.wakeTime} · Spavanje: ~${timeline.meta.bedTime}`
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
                        return index % 8 === 0 ? this.getLabelForValue(value) : '';
                    }
                }
            }
        }
    };
}

function renderNutritionSummary(day, totals) {
    const bmr = calculateBMR(state.userProfile.weight, state.userProfile.height, state.userProfile.age, state.userProfile.gender);
    const dailyTarget = bmr * (DAY_ACTIVITY_FACTORS[day.activityLoad] || 1.18);
    const totalActivityKcal = (day.activities || []).reduce((sum, a) => sum + (Number(a.calories) || 0), 0);
    const finalTarget = dailyTarget + totalActivityKcal;
    const macros = [
        { l: 'Energija', v: `${Math.round(totals.cals)} kcal`, p: (totals.cals / finalTarget) * 100, c: '#0078d4' },
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
    const entries = [];

    // ── Per-ingredient interactions ──
    day.meals.forEach(meal => {
        meal.ingredients
            .filter(ing => ing.interaction)
            .forEach(ing => {
                entries.push(`<div class="interaction-pill"><span class="food">${formatTime(meal.timestamp)} · ${ing.name}</span>: ${ing.interaction}</div>`);
            });
    });

    // ── Physiological model interactions ──
    const sortedMeals = [...day.meals].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const physioEntries = [];

    // Exercise-related variables for this meal
    const activities = day.activities || [];

    sortedMeals.forEach((meal, idx) => {
        const mealHour = getLocalMealHour(meal.timestamp);
        const timeStr = formatTime(meal.timestamp);
        const totals = calculateMealTotals(meal);

        // Calculate Glut-4 & Sympathetic slowing to display
        let glut4Boost = 0;
        let sympatheticSlowing = 0;
        let activeActivity = null;
        let postActivity = null;

        activities.forEach(act => {
            const actHour = getLocalMealHour(act.timestamp);
            const durationH = Math.max(0.1, (Number(act.durationMinutes) || 0) / 60);
            const actEndHour = actHour + durationH;
            
            // Post-exercise GLUT-4 insulin sensitivity boost
            const gap = normalizeDayHour(mealHour - actEndHour);
            if (gap >= 0 && gap < 16) {
                const decay = Math.exp(-Math.log(2) * gap / MODEL_CONSTANTS.exerciseEffects.glut4DecayHalfLifeHours);
                const boost = MODEL_CONSTANTS.exerciseEffects.glut4PeakBoost * decay;
                if (boost > glut4Boost) {
                    glut4Boost = boost;
                    postActivity = act;
                }
            }
            
            // Pre-exercise/During Exercise sympathetic gastric slowing
            const preWindow = MODEL_CONSTANTS.exerciseEffects.preExerciseWindowHours;
            const priorGap = normalizeDayHour(actEndHour - mealHour);
            if (priorGap >= 0 && priorGap <= durationH + preWindow) {
                const intensity = (Number(act.calories) || 300) / durationH;
                const intensityFactor = clamp(intensity / 400, 0.5, 1.2);
                const slowing = MODEL_CONSTANTS.exerciseEffects.sympatheticSlowingMax * intensityFactor;
                if (slowing > sympatheticSlowing) {
                    sympatheticSlowing = slowing;
                    activeActivity = act;
                }
            }
        });

        if (glut4Boost > 0.05) {
            physioEntries.push(`<div class="interaction-pill" style="border-left-color: #8661c5;"><span class="food">${timeStr} · Inzulinska osjetljivost (Trening)</span>: Pojačano crpljenje glukoze zbog aktivnosti ("${postActivity.name}"). Inzulinska osjetljivost povišena je za ~${Math.round(glut4Boost * 100)}%, apsorpcija u mišiće je znatno učinkovitija.</div>`);
        }
        if (sympatheticSlowing > 0.10) {
            physioEntries.push(`<div class="interaction-pill" style="border-left-color: #a4262c;"><span class="food">${timeStr} · Usporena probava (Trening)</span>: Zbog blizine aktivnosti ("${activeActivity.name}"), protok krvi u probavnom sustavu je smanjen. Pražnjenje želuca je usporeno za ~${Math.round(sympatheticSlowing * 100)}%.</div>`);
        }

        // Circadian insight
        const circ = MODEL_CONSTANTS.circadian;
        const cf = 1 + circ.amplitude * Math.cos(2 * Math.PI * (mealHour - circ.peakHour) / 24);
        if (cf > 1.12) {
            physioEntries.push(`<div class="interaction-pill" style="border-left-color: #107c10;"><span class="food">${timeStr} · Cirkadijalni ritam</span>: Jutarnji obrok — inzulinska osjetljivost je visoka (${Math.round(cf * 100 - 100)}% iznad prosjeka). Ugljikohidrati se brže apsorbiraju i daju blaži profil.</div>`);
        } else if (cf < 0.88) {
            physioEntries.push(`<div class="interaction-pill" style="border-left-color: #d83b01;"><span class="food">${timeStr} · Cirkadijalni ritam</span>: Večernji obrok — inzulinska osjetljivost je niža (${Math.round(100 - cf * 100)}% ispod prosjeka). Glukoza se sporije obrađuje, peak traje dulje.</div>`);
        }

        // TEF insight (only for protein-heavy meals)
        if (totals.prot > 20) {
            const tefLoss = Math.round(totals.prot * 4 * MODEL_CONSTANTS.tef.protein);
            physioEntries.push(`<div class="interaction-pill" style="border-left-color: #8661c5;"><span class="food">${timeStr} · Termički efekt</span>: Probava ${Math.round(totals.prot)}g proteina troši ~${tefLoss} kcal (~25% kalorija iz proteina). Neto energija je manja od bruto unosa.</div>`);
        }

        // Second meal effect
        if (idx > 0) {
            const prevMeal = sortedMeals[idx - 1];
            const prevTotals = calculateMealTotals(prevMeal);
            const prevHour = getLocalMealHour(prevMeal.timestamp);
            const gap = mealHour >= prevHour ? mealHour - prevHour : (mealHour + 24) - prevHour;
            const sme = MODEL_CONSTANTS.secondMealEffect;
            if (gap <= sme.maxGapHours && prevTotals.fiber >= sme.fiberThresholdGrams) {
                const prevHasLegumes = prevMeal.ingredients.some(ing =>
                    (ing.category || '').toLowerCase().includes('mahunark')
                );
                const fS = clamp((prevTotals.fiber - sme.fiberThresholdGrams) / 12, 0, 1);
                const decay = Math.exp(-Math.log(2) * gap / sme.decayHalfLifeHours);
                const reduction = clamp(sme.maxReduction * fS * (prevHasLegumes ? 1.4 : 1) * decay, 0, sme.maxReduction);
                if (reduction > 0.03) {
                    physioEntries.push(`<div class="interaction-pill" style="border-left-color: #0078d4;"><span class="food">${timeStr} · Second meal efekt</span>: Prethodni obrok (${formatTime(prevMeal.timestamp)}) s ${Math.round(prevTotals.fiber)}g vlakana${prevHasLegumes ? ' i mahunarkama' : ''} smanjuje glikemijski odgovor ovog obroka za ~${Math.round(reduction * 100)}%.</div>`);
                }
            }
        }

        // Resistant starch
        if (meal.cookingMethod === 'boiled') {
            const rsIngs = meal.ingredients.filter(ing =>
                MODEL_CONSTANTS.resistantStarchFoods.some(f =>
                    (ing.name || '').toLowerCase().includes(f.toLowerCase())
                )
            );
            if (rsIngs.length > 0) {
                const names = rsIngs.map(i => i.name).join(', ');
                physioEntries.push(`<div class="interaction-pill" style="border-left-color: #107c10;"><span class="food">${timeStr} · Rezistentni škrob</span>: ${names} kuhan(i) — ako se ohlade, ~12% škroba postaje rezistentni škrob koji se ponaša poput vlakana i smanjuje GI.</div>`);
            }
        }

        // Acid modifier
        const acidIngs = meal.ingredients.filter(ing =>
            MODEL_CONSTANTS.acidFoods.some(a =>
                normalizeText(ing.name || '').includes(normalizeText(a))
            )
        );
        if (acidIngs.length > 0) {
            physioEntries.push(`<div class="interaction-pill" style="border-left-color: #107c10;"><span class="food">${timeStr} · Kiselina u obroku</span>: ${acidIngs.map(i => i.name).join(', ')} usporava pražnjenje želuca za ~15%, što blago snižava glikemijski vrh.</div>`);
        }

        // Soluble fiber
        let sf = 0;
        meal.ingredients.forEach(ing => {
            const cat = normalizeText(ing.category || '');
            const isSoluble = MODEL_CONSTANTS.solubleFiberCategories.some(c =>
                cat.includes(normalizeText(c))
            );
            if (isSoluble) sf += (ing.fiber || 0) * ((ing.amount || 100) / 100);
        });
        if (sf > 3) {
            physioEntries.push(`<div class="interaction-pill" style="border-left-color: #107c10;"><span class="food">${timeStr} · Topiva vlakna</span>: ~${Math.round(sf)}g topivih vlakana (iz mahunarki/žitarica) stvara gel u crijevima koji dodatno usporava apsorpciju glukoze.</div>`);
        }
    });

    const allEntries = [...entries, ...physioEntries];
    selectors.interactionsList.innerHTML = allEntries.length
        ? allEntries.join('')
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
