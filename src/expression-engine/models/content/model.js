
import { isNil, pick, flatten, find, uniq, sampleSize } from "lodash";
import { defaultCache } from "../../../util/cache";
import Sequelize from "sequelize";
import { parseGlobalId, createGlobalId } from "../../../util/node/model";

import {
  Channels,
  channelSchema,
  ChannelFields,
  // channelFieldSchema,
  ChannelTitles,
  channelTitleSchema,
  ChannelData,
  channelDataSchema,

  LowReorder,
  LowReorderOrder,
} from "./tables";

import {
  Matrix,
  MatrixCol,
} from "../ee/matrix";

import {
  Playa,
} from "../ee/playa";

import {
  Tags,
  TagEntries,
} from "../ee/tags";

import {
  Snippets,
} from "../ee/snippets";

import { EE } from "../ee";

export class Content extends EE {
  __type =  "Content";

  constructor({ cache } = { cache: defaultCache }) {
    super();
    this.cache = cache;
  }

  pickField(name, fields) {
    let fieldName = name;
    fields.forEach(x => {
      if (x.field_name !== name) return;

      fieldName = `field_id_${x.field_id}`;
    });

    return fieldName;
  }

  createFieldNames(fields, remove) {
    return fields.map(field => {
      let name = field.field_name;

      if (remove) {
        let splitName = name.split("_");
        splitName.shift();
        name = splitName.join("_");
      } else {
        name = `${name}@dynamic`;
      }

      return [`field_id_${field.field_id}`, name];
    });
  }

  async getFromId(id, guid) {
    if (!id) return Promise.resolve(null);
    const fields = await this.cache.get(`fields:${id}`, () => ChannelData.find({
      where: { entry_id: Number(id) },
      include: [ { model: Channels.model,  include: [ { model: ChannelFields.model } ] } ],
    })
      .then(x => flatten(x.map(y => y.exp_channel.exp_channel_field)))
      .then(x => this.createFieldNames(x, true))
    );

    const exp_channel_fields = this.createFieldObject(fields);
    return await this.cache.get(guid, () => ChannelData.findOne({
      where: { entry_id: Number(id) },
      attributes:  ["entry_id", "channel_id", "site_id"].concat(fields),
      include: [
        { model: Channels.model},
        {
          model: ChannelTitles.model,
          where: {
            expiration_date: {
              $or: [
                { $eq: 0 },
                { $gt: Sequelize.literal("UNIX_TIMESTAMP(NOW())") },
              ],
            },
          },
        },
      ],
    })
      .then(x => {
        if (!x.exp_channel) return null;
        x.exp_channel.exp_channel_fields = exp_channel_fields;
        return x;
      })
    );
  }

  async getFromPublishedId(id, guid) {
    console.log(id)
    if (!id) return Promise.resolve();
    const fields = await this.cache.get(`fields:${id}`, () => ChannelData.find({
      where: { entry_id: Number(id) },
      include: [ { model: Channels.model,  include: [ { model: ChannelFields.model } ] } ],
    })
      .then(this.debug)
      .then(x => flatten(x.map(y => y.exp_channel.exp_channel_field)))
      .then(x => this.createFieldNames(x, true))
    );

    const exp_channel_fields = this.createFieldObject(fields);
    return await this.cache.get(`future:${guid}`, () => ChannelData.findOne({
      where: { entry_id: Number(id) },
      attributes:  ["entry_id", "channel_id", "site_id"].concat(fields),
      include: [
        { model: Channels.model},
        {
          model: ChannelTitles.model,
          where: {
            entry_date: { $lte: Sequelize.literal("UNIX_TIMESTAMP(NOW())") },
            expiration_date: {
              $or: [
                { $eq: 0 },
                { $gt: Sequelize.literal("UNIX_TIMESTAMP(NOW())") },
              ],
            },
          },
        },
      ],
    })
      .then(x => {
        if (!x.exp_channel) return null;
        x.exp_channel.exp_channel_fields = exp_channel_fields;
        return x;
      })
    );
  }

  createFieldObject(fields) {
    let fieldObject = {};
    fields.forEach(x => {
      const [fieldId, fieldName] = x;
      fieldObject[fieldName] = fieldId;
    });
    return fieldObject;
  }

  async getContentFromMatrix(entry_id, name, field_id) {
    if (!entry_id || !field_id) return [];

    const columns = await this.cache.get(`matrix:${field_id}`, () => MatrixCol.find({
        where: { field_id },
        attributes: ["col_id", "col_name", "col_label"],
      }));

    let columnIds = columns.map(x => [`col_id_${x.col_id}`, x.col_name]);

    const query = { entry_id, name, field_id };
    return await this.cache.get(this.cache.encode(query), () => ChannelData.find({
      where: { entry_id },
      attributes: ["entry_id"],
      include: [
        { model: Matrix.model, where: { field_id }, attributes: columnIds },
      ],
    })
      .then(x => flatten(x.map(y => y.exp_matrix_data))));
  };

  async getFromLowReorderSet(setName) {
    // XXX cache breaking on this set
    return await this.cache.get(`${setName}:LowReorderSetName`, () => LowReorderOrder.findOne({
      attributes: ["sort_order"],
      include: [{ model: LowReorder.model, where: { set_name: setName } }],
    })
      .then(x => x.sort_order.split("|"))
      .then(x => x.filter(y => !!y).map(z => ({ entry_id: z }))) // used so the next line can work
      .then(this.getFromPublishedIds)
      .then(x => x.filter(y => !!y))
    , { ttl: 3600 }); // expire this lookup every hour
  }

  async getEntryFromFieldValue(value, field_id, channel_id) {

    let include = [];
    if (channel_id) {
      include = [{ model: Channels.model, where: { channel_id } }];
    }

    let vars = { value, field_id, channel_id };
    return this.cache.get(this.cache.encode(vars), () => ChannelData.findOne({
      attributes: ["entry_id"],
      where: { [field_id]: value },
      include,
    })
      .then(x => ([x]))// used so the next line can work
      .then(this.getFromPublishedIds)
      .then(x => (x[0]))
    );
  }

  getFromPublishedIds = async (data = []) => {
    if (!data || !data.length) return Promise.resolve([]);
    return Promise.all(data.map(x => this.getFromPublishedId(x[this.id], createGlobalId(x[this.id], this.__type))))
      .then(flatten)
      .then(x => x.filter(y => !isNil(y)).map(z => {
        const item = z;
        item.__type = this.__type;
        return item;
      }));
  }

  async findByParentId(entry_id, channels = [], future = false) {
    const fetchMethod = future ? this.getFromIds : this.getFromPublishedIds;
    // XXX make this single request by relating entries via ChannelData
    return this.cache.get(`${entry_id}:Playa`, () => Playa.find({
        where: { child_entry_id: entry_id },
        attributes: [["parent_entry_id", "entry_id"]],
      })
    , { cache: false }) // this intermentally breaks when cached
      .then(fetchMethod.bind(this))
      // XXX remove when channel is part of query
      .then((x) => x.filter(
        y => !channels.length || channels.indexOf(y && y.exp_channel.channel_name) > -1
      ))
      ;
  }

  async findByChildId(entry_id) {
    return this.cache.get(`${entry_id}:Playa`, () => Playa.findOne({
        where: { parent_entry_id: entry_id },
        attributes: [["child_entry_id", "entry_id"]],
      })
    )
      .then(x => [x])
      .then(this.getFromPublishedIds)
      .then(x => x[0])
      ;
  }

  async getLiveStream() {
    return this.getIsLive()
      .then(x => (!x ? { isLive: false } : x))
      .then(({ isLive }) => {
        if (!isLive) return { isLive, snippet_contents: null };

        return this.getStreamUrl()
            .then(({ snippet_contents }) => ({isLive, snippet_contents}));
      });
  }

  async getStreamUrl() {
    return this.cache.get("snippets:PUBLIC_EMBED_CODE", () => Snippets.findOne({
      where: { snippet_name: "PUBLIC_EMBED_CODE" },
    }));
  }

  async getIsLive() {
    return this.cache.get("newspring:live", () => ChannelData.db.query(`
      SELECT
        ((WEEKDAY(CONVERT_TZ(NOW(),'+00:00','America/Detroit')) + 1) % 7) = m.col_id_366
            AND (SELECT DATE_FORMAT(CONVERT_TZ(NOW(),'+00:00','America/Detroit'),'%H%i') TIMEONLY) BETWEEN m.col_id_367 AND m.col_id_368 AS isLive,
            d.entry_id,
            t.status
      FROM
        exp_channel_data d
        JOIN exp_channel_titles t ON t.entry_id = d.entry_id
        JOIN exp_matrix_data m ON m.entry_id = d.entry_id
      WHERE
        d.channel_id = 175
        AND t.status = 'Live Stream Schedule'
        AND t.entry_date <= UNIX_TIMESTAMP()
        AND (t.expiration_date = 0 OR t.expiration_date >= UNIX_TIMESTAMP())
        AND m.col_id_366 IS NOT NULL;
    `, { type: Sequelize.QueryTypes.SELECT})
    , { ttl: 60 })
      .then(x => find(x, { isLive: 1 }))
      // tslint:enable
  }

  async findByTagName({ tagName, includeChannels }, { limit, offset }, cache) {
    // XXX fix no includeChannels on query
    includeChannels || (includeChannels = []); // tslint:disable-line
    const query = { tagName, limit, offset, includeChannels };
    return this.cache.get(this.cache.encode(query, this.__type), () => ChannelData.find({
        attributes: ["entry_id"],
        order: [
          [ChannelTitles.model, "entry_date", "DESC"],
        ],
        include: [
          {
            model: ChannelTitles.model,
            where: {
              status: { $or: ["open", "featured" ]},
              entry_date: { $lte: Sequelize.literal("UNIX_TIMESTAMP(NOW())") },
              expiration_date: {
                $or: [
                  { $eq: 0 },
                  { $gt: Sequelize.literal("UNIX_TIMESTAMP(NOW())") },
                ],
              },
            },
          },
          { model: Channels.model, where: { channel_name: { $or: includeChannels }} },
          {
            model: TagEntries.model,
            include: [
              {
                model: Tags.model,
                where: { tag_name: { $like: tagName }},
              },
            ],
          },
        ],
      })
    , { ttl: 3600, cache })
      .then(x => {
        // XXX find how to do this in the query?
        return x.slice(offset, limit + offset);
      })
      .then(this.getFromPublishedIds.bind)
      .then(x => x.filter(y => !!y))
      ;
  }


  async findByTags({ tags, includeChannels, excludedIds }, { offset, limit }, cache) {
    includeChannels || (includeChannels = []); // tslint:disable-line
     let channels = [
          "devotionals",
          "articles",
          "series_newspring",
          "sermons",
          "stories",
          "newspring_albums",
        ];

      /*

        Currently excluded channels come in uppercase and not the actual
        channel name. Here we fix that

        XXX make the setting dynamic and pulled from heighliner

      */
      includeChannels = includeChannels
        .map(x => x.toLowerCase())
        .map(x => {
          if (x === "series") return "series_newspring";
          if (x === "music") return "albums_newspring";
          return x;
        });

    // only include what user hasn't excluded
    includeChannels = uniq(channels.concat(includeChannels));
    excludedIds = excludedIds.map(x => parseGlobalId(x).id);
    const query = { tags, limit, offset, includeChannels, excludedIds };

    // XXX would be great to add a WileySort to weight by tags
    // XXX could / should we weight by users preference?
    return this.cache.get(this.cache.encode(query, this.__type), () => ChannelData.find({
        attributes: ["entry_id"],
        where: { entry_id: { $notIn: excludedIds } },
        order: [
          [ChannelTitles.model, "entry_date", "DESC"],
        ],
        include: [
          {
            model: ChannelTitles.model,
            where: {
              status: { $or: ["open", "featured" ]},
              entry_date: { $lte: Sequelize.literal("UNIX_TIMESTAMP(NOW())") },
              expiration_date: {
                $or: [
                  { $eq: 0 },
                  { $gt: Sequelize.literal("UNIX_TIMESTAMP(NOW())") },
                ],
              },
            },
          },
          { model: Channels.model, where: { channel_name: { $or: includeChannels }} },
          {
            model: TagEntries.model,
            include: [
              {
                model: Tags.model,
                where: { tag_name: { $in: tags }},
              },
            ],
          },
        ],
      })
    , { ttl: 3600, cache })
      .then(x => {
        // XXX find how to do this in the query?
        // return x.slice(offset, limit + offset);
        // XXX make a WileySort for this instead of random stuff
        return sampleSize(x, limit);
      })
      .then(this.getFromPublishedIds)
      .then(x => x.filter(y => !!y))
      ;
  }

  async find(query = {}, cache) {
    const { limit, offset } = query; // true options

    // channel data fields
    const channelData = pick(query,  Object.keys(channelDataSchema));
    const channel = pick(query, Object.keys(channelSchema));
    // const channelFields = pick(query, Object.keys(channelFieldSchema));
    const channelTitle = pick(query, Object.keys(channelTitleSchema));
    // This gets reset every hour currently
    channelTitle.entry_date = {
      $lte: Sequelize.literal("UNIX_TIMESTAMP(NOW())"),
    };
    channelTitle.expiration_date = {
      $or: [
        { $eq: 0 },
        { $gt: Sequelize.literal("UNIX_TIMESTAMP(NOW())") },
      ],
    };

    if (channelTitle.status === "open") channelTitle.status = { $or: ["open", "featured"] };
    return await this.cache.get(this.cache.encode(query, this.__type), () => ChannelData.find({
      where: channelData,
      attributes: ["entry_id"],
      order: [
        [ChannelTitles.model, "entry_date", "DESC"],
      ],
      include: [
        { model: Channels.model, where: channel },
        { model: ChannelTitles.model, where: channelTitle },
      ],
      limit,
      offset,
    })
    , { ttl: 3600, cache: false })
      .then(this.getFromPublishedIds)
      .then((x) => x.filter(y => !!y))
      ;
  }

}

export default {
  Content,
};
