import type { ActivityEvent } from '../shared/types.js';

function formatActionTag(action: string): string {
  if (action === 'tabs.navigate') return 'NAV';
  if (action === 'tabs.new') return 'TAB+';
  if (action === 'tabs.close') return 'TAB-';
  if (action === 'automation.click') return 'CLICK';
  if (action === 'automation.type') return 'TYPE';
  if (action === 'automation.getDOM') return 'DOM';
  if (action === 'automation.extract') return 'EXTRACT';
  if (action === 'automation.screenshot') return 'SHOT';
  if (action === 'tasks.requestIntervention') return 'HUMAN';
  if (action === 'tasks.resumeIntervention') return 'RESUME';
  return action.split('.').pop()?.toUpperCase() || 'ACT';
}

/** Live feed of the latest AI actions in the side panel. */
export function setupActivityFeed(): void {
  let activityCount = 0;
  const activityList = document.getElementById('activity-list');
  const activityCounter = document.getElementById('activity-counter');
  if (activityList && window.browser.onActivity) {
    window.browser.onActivity((event: ActivityEvent) => {
      activityCount++;
      if (activityCounter) activityCounter.textContent = `${activityCount} aksi`;
      const emptyEl = activityList.querySelector('.activity-empty');
      if (emptyEl) emptyEl.remove();
  
      const item = document.createElement('div');
      item.className = `activity-item status-${event.status}`;
  
      const top = document.createElement('div');
      top.className = 'activity-item-top';
  
      const tag = document.createElement('span');
      tag.className = 'activity-tag';
      tag.textContent = formatActionTag(event.action);
  
      const time = document.createElement('span');
      time.className = 'activity-time';
      const date = new Date(event.timestamp);
      time.textContent = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
  
      top.append(tag, time);
  
      const summary = document.createElement('div');
      summary.className = 'activity-summary';
      summary.textContent = event.summary;
  
      item.append(top, summary);
      activityList.prepend(item);
  
      while (activityList.children.length > 25) {
        activityList.lastElementChild?.remove();
      }
    });
  }
}
