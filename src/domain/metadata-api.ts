import * as api from '@actual-app/api';
import { APITagEntity } from '@actual-app/api/models';
import { initActualApi } from '../actual-api.js';

export async function getTags(): Promise<APITagEntity[]> {
  await initActualApi();
  return api.getTags();
}

export async function createTag(tag: Omit<APITagEntity, 'id'>): Promise<string> {
  await initActualApi();
  return api.createTag(tag);
}

export async function updateTag(id: string, fields: Partial<Omit<APITagEntity, 'id'>>): Promise<void> {
  await initActualApi();
  await api.updateTag(id, fields);
}

export async function deleteTag(id: string): Promise<void> {
  await initActualApi();
  await api.deleteTag(id);
}

export async function getNote(id: string): Promise<{ id: string; note: string } | null> {
  await initActualApi();
  return api.getNote(id);
}

export async function updateNote(id: string, note: string): Promise<void> {
  await initActualApi();
  await api.updateNote(id, note);
}

export async function mergePayees(targetId: string, mergeIds: string[]): Promise<void> {
  await initActualApi();
  await api.mergePayees(targetId, mergeIds);
}
