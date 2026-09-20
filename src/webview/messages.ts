export type Side = 'jp' | 'en';

export interface PageUpdateMessage {
  type: 'page-update';
  side: Side;
  page: number;
  totalPages: number;
}

export interface NavigateCommand {
  type: 'navigate';
  targetPage: number;
}
