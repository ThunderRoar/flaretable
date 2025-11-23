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
    const filtered = html.replace(/<[^>]*>/g, '');
    console.log(filtered);
    
    const response = await fetch('http://localhost:8787/cf-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filtered }),
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
        location: event.location,
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

function formatEventTime(date: Date) {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const strMinutes = minutes < 10 ? '0' + minutes : minutes;
  return hours + ':' + strMinutes + ' ' + ampm;
}

function getEventStyle(event: any) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const top = (start.getHours() * 60) + start.getMinutes();
  const durationMs = end.getTime() - start.getTime();
  const height = Math.max(durationMs / (1000 * 60), 30); // Min height 30px

  const colors = [
    { bg: 'rgba(66, 133, 244, 0.7)', border: '#4285F4' },
    { bg: 'rgba(234, 67, 53, 0.7)', border: '#EA4335' },
    { bg: 'rgba(52, 168, 83, 0.7)', border: '#34A853' },
    { bg: 'rgba(251, 188, 5, 0.7)', border: '#FBBC05' },
    { bg: 'rgba(252, 163, 17, 0.7)', border: '#FCA311' },
    { bg: 'rgba(156, 39, 176, 0.7)', border: '#9C27B0' },
    { bg: 'rgba(255, 112, 167, 0.7)', border: '#FF70A7' },
    { bg: 'rgba(0, 188, 212, 0.7)', border: '#00BCD4' }
  ];
  
  // Generate a consistent color index based on the event ID string
  let hash = 0;
  const str = event.id || event.title || '';
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % colors.length;
  const color = colors[colorIndex];

  return {
    top: `${top}px`,
    height: `${height}px`,
    backgroundColor: color.bg,
    borderLeft: `3px solid ${color.border}`,
    zIndex: 10
  };
}
</script>

<template>
  <div class="app-container">
    <!-- Choice View -->
    <div v-if="currentView === 'choice'" class="choice-view glass-panel">
      <h1 class="title">FlareTable</h1>
      <p class="subtitle">Your schedule, your way.</p>
      
      <div class="actions">
        <button v-if="hasIcsData" @click="showPreview" class="action-btn primary">
          <span class="icon">📅</span>
          View Preview
        </button>
        
        <button v-if="hasIcsData" @click="downloadIcs" class="action-btn secondary">
          <span class="icon">📥</span>
          Download .ics
        </button>

        <button @click="extractHtml" class="action-btn secondary" :disabled="loading">
          <span v-if="loading" class="spinner"></span>
          <span v-else class="icon">📄</span>
          {{ loading ? 'Processing...' : 'Extract HTML' }}
        </button>
      </div>
    </div>

    <!-- Calendar View -->
    <div v-else class="calendar-view">
      <!-- Week Navigation -->
      <div class="calendar-nav glass-panel">
        <button @click="currentView = 'choice'" class="nav-btn back-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          Back
        </button>
        <div class="nav-controls">
          <button @click="previousWeek" class="nav-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <div class="week-info">
            <span class="week-label">{{ weekRangeText }}</span>
          </div>
          <button @click="nextWeek" class="nav-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      </div>

      <!-- Calendar Grid -->
      <div class="calendar-grid">
        <!-- Time Column -->
        <div class="time-column">
          <div class="time-header"></div>
          <div v-for="hour in hours" :key="hour" class="time-slot">
            <span class="time-label">{{ formatHour(hour) }}</span>
          </div>
        </div>

        <!-- Days Columns -->
        <div class="days-container">
          <!-- Day Headers -->
          <div class="day-headers">
            <div 
              v-for="(day, index) in weekDays" 
              :key="index" 
              class="day-header"
              :class="{ 'today': isToday(day) }"
            >
              <span class="day-name">{{ formatDayName(day) }}</span>
              <span class="day-number" :class="{ 'today-number': isToday(day) }">
                {{ formatDayNumber(day) }}
              </span>
            </div>
          </div>

          <!-- Day Grid -->
          <div class="day-grid-container">
            <div 
              v-for="(day, dayIndex) in weekDays" 
              :key="dayIndex" 
              class="day-column"
            >
              <!-- Hour slots -->
              <div v-for="hour in hours" :key="`${dayIndex}-${hour}`" class="hour-slot"></div>
              
              <!-- Events -->
              <div 
                v-for="event in getEventsForDay(day)" 
                :key="event.id"
                class="calendar-event glass-event"
                :style="getEventStyle(event)"
              >
                <div class="event-time">{{ formatEventTime(event.start) }}</div>
                <div class="event-title">{{ event.title }}</div>
                <div v-if="event.location" class="event-location">📍 {{ event.location }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

.choice-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  background: linear-gradient(135deg, rgba(252, 163, 17, 0.05), rgba(0, 0, 0, 0.2));
}

.title {
  font-size: 32px;
  font-weight: 800;
  margin: 0 0 8px;
  background: linear-gradient(135deg, #FFFFFF 0%, rgba(255, 255, 255, 0.7) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: -0.5px;
}

.subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
  margin: 0 0 32px;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 240px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  border-radius: 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.action-btn .icon {
  font-size: 18px;
}

.action-btn.primary {
  background: rgba(252, 163, 17, 0.9);
  color: #000;
  box-shadow: 0 4px 16px rgba(252, 163, 17, 0.3);
  border: none;
}

.action-btn.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(252, 163, 17, 0.4);
}

.action-btn.secondary {
  background: rgba(255, 255, 255, 0.05);
  color: #FFF;
  backdrop-filter: blur(10px);
}

.action-btn.secondary:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: translateY(-2px);
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none !important;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.calendar-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.calendar-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.06);
  margin: 16px 16px 0;
  border-radius: 16px;
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.1);
  gap: 16px;
}

.nav-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  justify-content: flex-end;
}

.back-btn {
  padding: 8px 12px;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.nav-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(20px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.1);
}

.nav-btn:hover {
  background: rgba(252, 163, 17, 0.2);
  border-color: rgba(252, 163, 17, 0.3);
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(252, 163, 17, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.15);
}

.nav-btn:active {
  transform: scale(0.95);
}

.nav-btn svg {
  color: rgba(255, 255, 255, 0.9);
}

.week-info {
  flex: 1;
  text-align: center;
}

.week-label {
  font-size: 14px;
  font-weight: 600;
  color: #FFFFFF;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.calendar-grid {
  flex: 1;
  display: flex;
  overflow: auto;
  background: rgba(0, 0, 0, 0.1);
  margin: 12px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  /* Hide scrollbar for IE, Edge and Firefox */
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* Hide scrollbar for Chrome, Safari and Opera */
.calendar-grid::-webkit-scrollbar {
  display: none;
}

.time-column {
  width: 60px;
  flex-shrink: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(40px);
  border-radius: 16px 0 0 16px;
}

.time-header {
  height: 60px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.time-slot {
  height: 60px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding-right: 8px;
  padding-top: 2px;
}

.time-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 500;
}

.days-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.day-headers {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(40px);
  border-radius: 0 16px 0 0;
}

.day-header {
  padding: 10px 4px;
  text-align: center;
  border-right: 1px solid rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.day-header:last-child {
  border-right: none;
}

.day-header.today {
  background: rgba(252, 163, 17, 0.08);
  position: relative;
}

.day-header.today::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(252, 163, 17, 0.6), transparent);
}

.day-name {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 600;
  letter-spacing: 0.3px;
}

.day-number {
  font-size: 20px;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.day-number.today-number {
  background: linear-gradient(135deg, rgba(252, 163, 17, 0.9), rgba(252, 163, 17, 0.7));
  color: #000000;
  backdrop-filter: blur(20px);
  box-shadow: 0 4px 16px rgba(252, 163, 17, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(252, 163, 17, 0.3);
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.day-grid-container {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  flex: 1;
  position: relative;
  background: rgba(0, 0, 0, 0.05);
}

.day-column {
  border-right: 1px solid rgba(255, 255, 255, 0.03);
  position: relative;
}

.day-column:last-child {
  border-right: none;
}

.hour-slot {
  height: 60px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  transition: background 0.2s;
}

.hour-slot:hover {
  background: rgba(255, 255, 255, 0.02);
}

.calendar-event {
  position: absolute;
  left: 2px;
  right: 2px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 11px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2);
}

.glass-event {
  border: 1px solid rgba(255, 255, 255, 0.15);
  position: relative;
  overflow: hidden;
}

.glass-event::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
}

.glass-event::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, transparent 50%);
  pointer-events: none;
}

.calendar-event:hover {
  transform: scale(1.05) translateY(-2px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3);
  z-index: 20 !important;
}

.calendar-event:active {
  transform: scale(1.02);
}

.event-time {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  margin-bottom: 2px;
  font-size: 10px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  gap: 4px;
}

.event-time::before {
  content: '○';
  font-size: 8px;
  opacity: 0.7;
}

.event-title {
  font-weight: 600;
  color: #FFFFFF;
  margin-bottom: 2px;
  line-height: 1.2;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.event-location {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.75);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  gap: 2px;
}
</style>