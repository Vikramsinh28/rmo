'use client';

import { useSafetyAlerts } from '@/hooks/useSafetyAlerts';

export function SafetyAlertCenter() {
  useSafetyAlerts();
  return null;
}
