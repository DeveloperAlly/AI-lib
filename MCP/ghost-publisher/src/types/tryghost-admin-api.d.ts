// Minimal typings for @tryghost/admin-api (the package ships none).
declare module '@tryghost/admin-api' {
  type Params = Record<string, unknown>;
  interface Resource {
    browse(params?: Params): Promise<any[] & { meta?: any }>;
    read(data: Params, params?: Params): Promise<any>;
    add(data: Params, params?: Params): Promise<any>;
    edit(data: Params, params?: Params): Promise<any>;
    delete(data: Params, params?: Params): Promise<any>;
  }
  export default class GhostAdminAPI {
    constructor(options: { url: string; key: string; version: string });
    posts: Resource;
    tags: Resource;
    site: { read(): Promise<any> };
    images: { upload(data: { file: string; ref?: string; purpose?: string }): Promise<{ url: string; ref?: string }> };
  }
}
