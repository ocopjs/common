import pWaterfall from "p-waterfall";

export class BaseOcopAdapter {
  config?: any;
  listAdapters?: any;
  listAdapterClass?: any;
  async _create(..._args: any) {}
  async _update(..._args: any) {}
  async _delete(..._args: any) {}
  async disconnect(..._args: any) {}
  async _connect(..._args: any) {}

  constructor(config = {}) {
    this.config = { ...config };
    this.listAdapters = {};
    this.listAdapterClass = undefined;
  }

  newListAdapter(key: any, adapterConfig: any) {
    this.listAdapters[key] = new this.listAdapterClass(
      key,
      this,
      adapterConfig,
    );
    return this.listAdapters[key];
  }

  getListAdapterByKey(key: any) {
    return this.listAdapters[key];
  }

  async connect({ rels }: any) {
    // Connect to the database
    await this._connect({ rels }, this.config);

    // Set up all list adapters
    try {
      // Validate the minimum database version requirements are met.
      await this.checkDatabaseVersion();

      const taskResults = await this.postConnect({ rels });
      const errors = taskResults
        ?.filter(({ isRejected }) => isRejected)
        .map(({ reason }) => reason);

      if (errors.length) {
        if (errors.length === 1) throw errors[0];
        const error = new Error(
          "Multiple errors in BaseOcopAdapter.postConnect():",
        ) as any;
        error.errors = errors;
        throw error;
      }
    } catch (error) {
      // close the database connection if it was opened
      try {
        await this.disconnect();
      } catch (closeError) {
        // Add the inability to close the database connection as an additional
        // error
        error.errors = error.errors || [];
        error.errors.push(closeError);
      }
      // re-throw the error
      throw error;
    }
  }

  async postConnect(_props: any): Promise<any[]> {
    return [];
  }

  async checkDatabaseVersion() {}
}

export class BaseListAdapter {
  key?: any;
  parentAdapter?: any;
  fieldAdapters: any[];
  fieldAdaptersByPath?: any;
  config?: any;
  preSaveHooks: any[];
  postReadHooks: any[];

  async _create(..._args: any) {}
  async _update(..._args: any) {}
  async _delete(..._args: any) {}
  async _itemsQuery(..._args: any): Promise<any[]> {
    return [];
  }

  constructor(key: any, parentAdapter: any, config: any) {
    this.key = key;
    this.parentAdapter = parentAdapter;
    this.fieldAdapters = [];
    this.fieldAdaptersByPath = {};
    this.config = config;

    this.preSaveHooks = [];
    this.postReadHooks = [
      (item: any) => {
        // FIXME: This can hopefully be removed once graphql 14.1.0 is released.
        // https://github.com/graphql/graphql-js/pull/1520
        if (item && item.id) item.id = item.id.toString();
        return item;
      },
    ];
  }

  newFieldAdapter(
    fieldAdapterClass: any,
    name: any,
    path: any,
    field: any,
    getListByKey: any,
    config: any,
  ) {
    const adapter = new fieldAdapterClass(
      name,
      path,
      field,
      this,
      getListByKey,
      config,
    );
    adapter.setupHooks({
      addPreSaveHook: this.addPreSaveHook.bind(this),
      addPostReadHook: this.addPostReadHook.bind(this),
    });
    this.fieldAdapters.push(adapter);
    this.fieldAdaptersByPath[adapter.path] = adapter;
    return adapter;
  }

  addPreSaveHook(hook: any) {
    this.preSaveHooks.push(hook);
  }

  addPostReadHook(hook: any) {
    this.postReadHooks.push(hook);
  }

  onPreSave(item: any) {
    // We waterfall so the final item is a composed version of the input passing
    // through each consecutive hook
    return pWaterfall(this.preSaveHooks, item);
  }

  async onPostRead(item: any) {
    // We waterfall so the final item is a composed version of the input passing
    // through each consecutive hook
    return pWaterfall(this.postReadHooks, await item);
  }

  async create(data: any) {
    return this.onPostRead(this._create(await this.onPreSave(data)));
  }

  async delete(id: any) {
    return this._delete(id);
  }

  async update(id: any, data: any) {
    return this.onPostRead(this._update(id, await this.onPreSave(data)));
  }

  async findAll() {
    return Promise.all(
      (await this._itemsQuery({})).map((item: any) => this.onPostRead(item)),
    );
  }

  async findById(id: any) {
    return this.onPostRead(
      (await this._itemsQuery({ where: { id }, first: 1 }))[0] || null,
    );
  }

  async find(condition: any) {
    return Promise.all(
      (await this._itemsQuery({ where: condition })).map((item: any) =>
        this.onPostRead(item),
      ),
    );
  }

  async findOne(condition: any) {
    return this.onPostRead(
      (await this._itemsQuery({ where: condition, first: 1 }))[0],
    );
  }

  async itemsQuery(args: any, { meta = false, from = {} } = {}) {
    const results = await this._itemsQuery(args, { meta, from });
    return meta
      ? results
      : Promise.all(results.map((item: any) => this.onPostRead(item)));
  }

  itemsQueryMeta(args: any) {
    return this.itemsQuery(args, { meta: true });
  }

  getFieldAdapterByPath(path: any) {
    return this.fieldAdaptersByPath[path];
  }
  getPrimaryKeyAdapter() {
    return this.fieldAdaptersByPath["id"];
  }
}

export class BaseFieldAdapter {
  fieldName?: any;
  path?: any;
  field?: any;
  listAdapter?: any;
  config?: any;
  getListByKey?: any;
  dbPath?: any;

  constructor(
    fieldName: any,
    path: any,
    field: any,
    listAdapter: any,
    getListByKey: any,
    config = {},
  ) {
    this.fieldName = fieldName;
    this.path = path;
    this.field = field;
    this.listAdapter = listAdapter;
    this.config = config;
    this.getListByKey = getListByKey;
    this.dbPath = path;
  }

  setupHooks() {}
}
