import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'bookmarks';

export interface Bookmark {
  id: string;
  createdAt: number;
  jpUrl: string;
  jpTitle: string;
  jpPage: number | null;
  enUrl: string;
  enTitle: string;
  enPage: number | null;
  pageDelta: number;
}

export async function loadBookmarks(): Promise<Bookmark[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Bookmark[];
  } catch {
    return [];
  }
}

export async function saveBookmarks(bookmarks: Bookmark[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}
