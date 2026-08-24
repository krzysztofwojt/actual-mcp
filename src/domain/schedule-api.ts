import * as api from '@actual-app/api';
import { APIScheduleEntity } from '@actual-app/api/models';
import { initActualApi } from '../actual-api.js';

export async function getSchedules(): Promise<APIScheduleEntity[]> {
  await initActualApi();
  return api.getSchedules();
}

export async function createSchedule(schedule: Omit<APIScheduleEntity, 'id'>): Promise<string> {
  await initActualApi();
  return api.createSchedule(schedule);
}

export async function updateSchedule(
  id: string,
  fields: Partial<APIScheduleEntity>,
  resetNextDate: boolean
): Promise<string> {
  await initActualApi();
  return api.updateSchedule(id, fields, resetNextDate);
}

export async function deleteSchedule(id: string): Promise<void> {
  await initActualApi();
  await api.deleteSchedule(id);
}
