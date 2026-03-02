export interface DingTalkTokenResult {
  accessToken: string;
  refreshToken: string;
  expireIn: number;
  corpId?: string;
}

export interface DingTalkUserInfo {
  nick: string;
  unionId: string;
  openId: string;
  avatarUrl?: string;
  email?: string;
  mobile?: string;
  stateCode?: string;
}

export interface DingTalkH5UserInfo {
  userid: string;
  unionid: string;
  name?: string;
  sys?: boolean;
  sysLevel?: number;
}

export interface DingTalkUserDetail {
  userid: string;
  unionid: string;
  name: string;
  avatar: string;
  email?: string;
  mobile?: string;
  title?: string;
  deptIdList?: number[];
}

export interface DingTalkCorpTokenResult {
  accessToken: string;
  expireIn: number;
}

export interface DingTalkEventPayload {
  encrypt: string;
}

export interface DingTalkEventDecrypted {
  EventType: string;
  UserId?: string[];
  CorpId?: string;
  TimeStamp?: string;
}

export interface DingTalkConfig {
  corpId: string;
  appKey: string;
  appSecret: string;
  agentId: string;
  eventToken?: string;
  eventAesKey?: string;
}
