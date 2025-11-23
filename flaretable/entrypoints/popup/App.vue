<script setup lang="ts">
import { ref, computed } from 'vue';
import { useToast } from 'vue-toastification';
import ICAL from 'ical.js';

const toast = useToast();

const currentView = ref('choice');
const loading = ref(false);
const icsData = ref('');
const events = ref<any[]>([]);
const currentWeekStart = ref(new Date());

const hasIcsData = computed(() => icsData.value.length > 0);

const weekDays = computed(() => {
  const days = [];
  const start = new Date(currentWeekStart.value);
  start.setDate(start.getDate() - start.getDay());
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push(day);
  }
  return days;
});

const weekRangeText = computed(() => {
  const start = weekDays.value[0];
  const end = weekDays.value[6];
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
});

const hours = Array.from({ length: 24 }, (_, i) => i);

// --- CORE LOGIC ---
async function extractHtml() {
  loading.value = true;
  try {
    // 1. Get active tab and validate its URL
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');

    const url = tab.url || '';
    if (!url.startsWith('http')) {
      throw new Error('Cannot run on this page. Please use a standard http/https page.');
    }

    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement.outerHTML,
    });
    const html = results?.[0]?.result;
    if (!html) throw new Error('Failed to capture page HTML.');

    const response = await fetch('http://localhost:8787/cf-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html }),
    });
    if (!response.ok) throw new Error(`Backend Error: ${response.statusText}`);

    const data = await response.json();
    if (!data.base64) throw new Error('Invalid response from backend.');

    icsData.value = data.base64;
    toast.success('Calendar extracted successfully!');
  } catch (err: any) {
    toast.error(err.message || 'An unknown error occurred.');
    console.error('[FlareTable Error]', err);
  } finally {
    loading.value = false;
  }
}

function showPreview() {
  if (!hasIcsData.value) return;
  try {
    const icsContent = atob(icsData.value);
    const jcalData = ICAL.parse(icsContent);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents('vevent');
    
    events.value = vevents.map((vevent: any) => {
      const event = new ICAL.Event(vevent);
      return {
        id: event.uid,
        title: event.summary,
        start: event.startDate.toJSDate(),
        end: event.endDate.toJSDate(),
      };
    });
    currentView.value = 'calendar';
  } catch (err) {
    toast.error('Failed to parse calendar data.');
    console.error('[FlareTable Error]', err);
  }
}

function downloadIcs() {
  if (!hasIcsData.value) return;
  try {
    const byteCharacters = atob(icsData.value);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'text/calendar' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'calendar.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Download started!');
  } catch (err) {
    toast.error('Failed to prepare download.');
    console.error('[FlareTable Error]', err);
  }
}

function previousWeek() {
  currentWeekStart.value.setDate(currentWeekStart.value.getDate() - 7);
  currentWeekStart.value = new Date(currentWeekStart.value);
}
function nextWeek() {
  currentWeekStart.value.setDate(currentWeekStart.value.getDate() + 7);
  currentWeekStart.value = new Date(currentWeekStart.value);
}
function formatHour(hour: number) {
  const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const period = hour >= 12 ? 'PM' : 'AM';
  return `${h} ${period}`;
}
function formatDayName(date: Date) { return date.toLocaleDateString('en-US', { weekday: 'short' }); }
function formatDayNumber(date: Date) { return date.getDate(); }
function isToday(date: Date) { return date.toDateString() === new Date().toDateString(); }
function getEventsForDay(day: Date) {
  return events.value.filter(event => new Date(event.start).toDateString() === day.toDateString());
}
function getEventPosition(event: any) {
  const start = new Date(event.start);
  return (start.getHours() + start.getMinutes() / 60) * 60; // 60px per hour
}
function getEventHeight(event: any) {
  const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime();
  const durationHours = durationMs / (1000 * 60 * 60);
  return Math.max(durationHours * 60, 30); // Min height 30px
}
</script>

<template>
  <div class="app-container">
    <div v-if="currentView === 'choice'" class="choice-view glass-panel">
      <h1 class="title">FlareTable</h1>
      <p class="subtitle">Your schedule, your way.</p>
      
      <div class="actions">
        <button v-if="hasIcsData" @click="showPreview" class="action-btn primary">
          <span class="icon">📅</span> View Preview
        </button>
        
        <button v-if="hasIcsData" @click="downloadIcs" class="action-btn secondary">
          <span class="icon">📥</span> Download .ics
        </button>

        <button @click="extractHtml" class="action-btn secondary" :disabled="loading">
          <span v-if="loading" class="spinner"></span>
          <span v-else class="icon">📄</span>
          {{ loading ? 'Processing...' : 'Extract HTML' }}
        </button>
      </div>
    </div>

    <div v-else class="calendar-view">
      <div class="calendar-nav glass-panel">
        <button @click="currentView = 'choice'" class="nav-btn back-btn">
          &lt; Back
        </button>
        <div class="nav-controls">
          <button @click="previousWeek" class="nav-btn">&lt;</button>
          <div class="week-info">
            <span class="week-label">{{ weekRangeText }}</span>
          </div>
          <button @click="nextWeek" class="nav-btn">&gt;</button>
        </div>
      </div>

      <div class="calendar-grid">
        <div class="time-column">
          <div class="time-header"></div>
          <div v-for="hour in hours" :key="hour" class="time-slot">
            <span class="time-label">{{ formatHour(hour) }}</span>
          </div>
        </div>

        <div class="days-container">
          <div class="day-headers">
            <div v-for="day in weekDays" :key="day.toISOString()" class="day-header" :class="{ 'today': isToday(day) }">
              <span class="day-name">{{ formatDayName(day) }}</span>
              <span class="day-number">{{ formatDayNumber(day) }}</span>
            </div>
          </div>
          <div class="day-columns">
            <div v-for="day in weekDays" :key="day.toISOString()" class="day-column">
              <div v-for="hour in hours" :key="hour" class="hour-line"></div>
              <div v-for="event in getEventsForDay(day)" :key="event.id" class="event-block" :style="{ top: getEventPosition(event) + 'px', height: getEventHeight(event) + 'px' }">
                <div class="event-title">{{ event.title }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.app-container {
  width: 100%;
  height: 100%;
  background: #f0f2f5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.choice-view { padding: 20px; text-align: center; }
.title { font-size: 24px; font-weight: bold; margin-bottom: 8px; }
.subtitle { font-size: 14px; color: #555; margin-bottom: 24px; }
.actions { display: flex; flex-direction: column; gap: 12px; }
.action-btn { padding: 12px; border-radius: 8px; border: 1px solid #ccc; background: #fff; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; transition: background-color 0.2s; }
.action-btn:hover { background-color: #f7f7f7; }
.action-btn.primary { background: #007aff; color: white; border-color: #007aff; }
.action-btn.primary:hover { background-color: #0056b3; }
.action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.spinner { width: 14px; height: 14px; border: 2px solid rgba(0,0,0,0.1); border-top-color: #333; border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.calendar-view { display: flex; flex-direction: column; height: 100%; }
.calendar-nav { padding: 8px; display: flex; justify-content: space-between; align-items: center; background: #fff; border-bottom: 1px solid #eee; }
.nav-btn { padding: 4px 8px; border: 1px solid #ddd; background-color: #fff; border-radius: 4px; cursor: pointer; }
.calendar-grid { display: flex; flex-grow: 1; overflow: auto; background-color: #fff; }
.time-column { font-size: 10px; color: #777; padding-top: 24px; /* Align with day headers */ }
.time-slot { height: 60px; text-align: right; padding-right: 4px; border-top: 1px solid #eee; position: relative; top: -1px; }
.days-container { display: flex; flex-direction: column; flex-grow: 1; }
.day-headers { display: flex; text-align: center; font-size: 12px; position: sticky; top: 0; background: #fff; z-index: 10; }
.day-header { flex: 1; padding: 4px; border-left: 1px solid #eee; }
.day-header .day-name { font-weight: 500; }
.day-header.today .day-number { background: #007aff; color: white; border-radius: 50%; width: 20px; height: 20px; display: inline-block; line-height: 20px; }
.day-columns { display: flex; flex-grow: 1; position: relative; }
.day-column { flex: 1; border-left: 1px solid #eee; position: relative; }
.hour-line { height: 60px; border-bottom: 1px solid #eee; }
.event-block { position: absolute; left: 2px; right: 2px; background: rgba(0, 122, 255, 0.8); color: white; border-radius: 4px; padding: 2px 4px; font-size: 10px; overflow: hidden; z-index: 1; }
.event-title { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>