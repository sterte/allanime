export type Side = 'jp' | 'en';

export interface PageUpdateMessage {
  type: 'page-update';
  side: Side;
  page: number;
  totalPages: number;
  url: string;
  title: string;
}

export interface NavigateCommand {
  type: 'navigate';
  targetPage: number;
}
