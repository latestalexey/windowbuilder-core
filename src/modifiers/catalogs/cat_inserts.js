
/**
 * Дополнительные методы справочника Вставки
 *
 * Created 23.12.2015<br />
 * &copy; http://www.oknosoft.ru 2014-2018
 * @author Evgeniy Malyarov
 * @module cat_inserts
 */

// подписываемся на событие после загрузки из pouchdb-ram и готовности предопределенных
(({md, cat, enm, cch, dp, utils, adapters: {pouch}, job_prm}) => {

  if(job_prm.use_ram !== false){
    md.once('predefined_elmnts_inited', () => {
      cat.scheme_settings && cat.scheme_settings.find_schemas('dp.buyers_order.production');
    });
  }

  cat.inserts.__define({

    _inserts_types_filling: {
      value: [
        enm.inserts_types.Заполнение
      ]
    },

    /**
     * возвращает возможные параметры вставок данного типа
     */
    _prms_by_type: {
      value(insert_type) {
        const prms = new Set();
        this.find_rows({available: true, insert_type}, (inset) => {
          inset.used_params.forEach((param) => {
            !param.is_calculated && prms.add(param);
          });
          inset.specification.forEach(({nom}) => {
            if(nom){
              const {used_params} = nom;
              used_params && used_params.forEach((param) => {
                !param.is_calculated && prms.add(param);
              });
            }
          });
        });
        return prms;
      }
    },

    ItemData: {
      value: class ItemData {

        constructor(item, Renderer) {

          this.Renderer = Renderer;
          this.count = 0;
          const idata = this;

          // индивидуальные классы строк
          class ItemRow extends $p.DpBuyers_orderProductionRow {

            // корректирует метаданные полей свойств через связи параметров выбора
            tune(ref, mf, column) {

              const {inset} = this;
              const prm = cch.properties.get(ref);

              // удаляем все связи, кроме владельца
              if(mf.choice_params) {
                const adel = new Set();
                for(const choice of mf.choice_params) {
                  if(choice.name !== 'owner' && choice.path != prm) {
                    adel.add(choice);
                  }
                }
                for(const choice of adel) {
                  mf.choice_params.splice(mf.choice_params.indexOf(choice), 1);
                }
              }
              else {
                mf.choice_params = [];
              }

              // если параметр не используется в текущей вставке, делаем ячейку readonly
              const prms = new Set();
              inset.used_params.forEach((param) => {
                !param.is_calculated && prms.add(param);
              });
              inset.specification.forEach(({nom}) => {
                if(nom){
                  const {used_params} = nom;
                  used_params && used_params.forEach((param) => {
                    !param.is_calculated && prms.add(param);
                  });
                }
              });
              mf.read_only = !prms.has(prm);

              // находим связи параметров
              if(!mf.read_only) {
                const links = prm.params_links({grid: {selection: {}}, obj: this});
                const hide = links.some((link) => link.hide);
                if(hide && !mf.read_only) {
                  mf.read_only = true;
                }

                // проверим вхождение значения в доступные и при необходимости изменим
                if(links.length) {
                  // TODO: подумать про установку умолчаний
                  //prm.linked_values(links, this);
                  const filter = {}
                  prm.filter_params_links(filter, null, links);
                  filter.ref && mf.choice_params.push({
                    name: 'ref',
                    path: filter.ref,
                  });
                }

              }
            }

            get_row(param) {
              const {product_params} = this._owner._owner;
              return product_params.find({elm: this.row, param}) || product_params.add({elm: this.row, param});
            }

            value_change(field, type, value) {
              if(field === 'inset') {
                value = cat.inserts.get(value);
                if(value.insert_type == enm.inserts_types.Параметрик) {
                  idata.tune_meta(value, this);
                }
              }
              super.value_change(field, type, value);
            }
          }

          this.ProductionRow = ItemRow;

          // отбор по типу вставки
          this.meta = utils._clone(dp.buyers_order.metadata('production'));
          this.meta.fields.inset.choice_params[0].path = item;
          this.meta.fields.inset.disable_clear = true;

          // получаем возможные параметры вставок данного типа
          if(item !== enm.inserts_types.Параметрик) {
            const changed = this.tune_meta(item);
            const {current_user} = $p;
            for(const scheme of changed) {
              if(pouch.local.doc.adapter === 'http' && !scheme.user) {
                current_user && current_user.roles.includes('doc_full') && scheme.save();
              }
              else {
                scheme.save();
              }
            }
          }

        }

        tune_meta(item, prototype) {
          const changed = new Set();
          let params, with_scheme, meta;

          if(!prototype) {
            prototype = this.ProductionRow.prototype;
            params = cat.inserts._prms_by_type(item);
            with_scheme = true;
            meta = this.meta;
          }
          else {
            params = new Set();
            item.product_params.forEach(({param}) => params.add(param));
            if(!prototype._meta) {
              Object.defineProperty(prototype, '_meta', {value: utils._clone(this.meta)});
            }
            meta = prototype._meta;
          }

          // прибиваем лишние параметры прежней вставки
          if(!with_scheme) {
            for(const fld in prototype) {
              if(utils.is_guid(fld) && !Array.from(params).some(({ref}) => ref === fld)) {
                delete prototype[fld];
                delete meta.fields[fld];
                if(prototype._owner && prototype._owner._owner) {
                  const {product_params} = prototype._owner._owner;
                  for(const rm of product_params.find_rows({elm: prototype.row, fld})) {
                    product_params.del(rm);
                  }
                }
              }
            }
          }

          for (const param of params) {

            // корректируем схему
            if(with_scheme) {
              cat.scheme_settings.find_rows({obj: 'dp.buyers_order.production', name: item.name}, (scheme) => {
                if(!scheme.fields.find({field: param.ref})) {
                  // добавляем строку с новым полем
                  const row = scheme.fields.add({
                    field: param.ref,
                    caption: param.caption,
                    use: true,
                  });
                  const note = scheme.fields.find({field: 'note'});
                  note && scheme.fields.swap(row, note);

                  changed.add(scheme);
                }
              });
            }

            // корректируем метаданные
            if(!meta.fields[param.ref]) {
              meta.fields[param.ref] = {
                synonym: param.caption,
                type: param.type,
              };
            }
            const mf = meta.fields[param.ref];

            // отбор по владельцу
            if(param.type.types.some(type => type === 'cat.property_values')) {
              mf.choice_params = [{name: 'owner', path: param}];
            }

            // учтём дискретный ряд
            const drow = item.product_params && item.product_params.find({param});
            if(drow && drow.list) {
              try{
                mf.list = JSON.parse(drow.list);
              }
              catch (e) {
                delete mf.list;
              }
            }
            else {
              delete mf.list;
            }

            // корректируем класс строки
            if(!prototype.hasOwnProperty(param.ref)){
              Object.defineProperty(prototype, param.ref, {
                get() {
                  return this.get_row(param).value;
                },
                set(v) {
                  this.get_row(param).value = v;
                },
                configurable: true,
                enumerable: true,
              });
            }
          }

          return changed;
        }

      }
    },

    by_thickness: {
      value(min, max) {

        if(!this._by_thickness){
          this._by_thickness = {};
          this.find_rows({insert_type: {in: this._inserts_types_filling}}, (ins) => {
            if(ins.thickness > 0){
              if(!this._by_thickness[ins.thickness])
                this._by_thickness[ins.thickness] = [];
              this._by_thickness[ins.thickness].push(ins);
            }
          });
        }

        const res = [];
        for(let thickness in this._by_thickness){
          if(parseFloat(thickness) >= min && parseFloat(thickness) <= max)
            Array.prototype.push.apply(res, this._by_thickness[thickness]);
        }
        return res;

      }
    },

    sql_selection_list_flds: {
      value(initial_value) {
        return "SELECT _t_.ref, _t_.`_deleted`, _t_.is_folder, _t_.id,_t_.note as note,_t_.priority as priority ,_t_.name as presentation, _k_.synonym as insert_type," +
          " case when _t_.ref = '" + initial_value + "' then 0 else 1 end as is_initial_value FROM cat_inserts AS _t_" +
          " left outer join enm_inserts_types as _k_ on _k_.ref = _t_.insert_type %3 ORDER BY is_initial_value, priority desc, presentation LIMIT 1000 ";
      }
    },

    sql_selection_where_flds: {
      value(filter){
        return ` OR _t_.note LIKE '${filter}' OR _t_.id LIKE '${filter}' OR _t_.name LIKE '${filter}'`;
      }
    },

  });

  cat.inserts.metadata('selection_params').index = 'elm';
  cat.inserts.metadata('specification').index = 'is_main_elm';

  // переопределяем прототип
  $p.CatInserts = class CatInserts extends $p.CatInserts {

    /**
     * Возвращает номенклатуру вставки в завсисмости от свойств элемента
     */
    nom(elm, strict) {

      const {_data} = this;

      if(!strict && !elm && _data.nom) {
        return _data.nom;
      }

      const main_rows = [];
      let _nom;

      const {check_params} = ProductsBuilding;

      this.specification.find_rows({is_main_elm: true}, (row) => {
        // если есть элемент, фильтруем по параметрам
        if(elm && !check_params({
          params: this.selection_params,
          ox: elm.project.ox,
          elm: elm,
          row_spec: row,
          cnstr: 0,
          origin: elm.fake_origin || 0,
        })) {
          return;
        }
        main_rows.push(row)
      });

      if(!main_rows.length && !strict && this.specification.count()){
        main_rows.push(this.specification.get(0))
      }

      if(main_rows.length && main_rows[0].nom instanceof $p.CatInserts){
        if(main_rows[0].nom == this){
          _nom = cat.nom.get()
        }
        else{
          _nom = main_rows[0].nom.nom(elm, strict)
        }
      }
      else if(main_rows.length){
        if(elm && !main_rows[0].formula.empty()){
          try{
            _nom = main_rows[0].formula.execute({elm});
            if(!_nom){
              _nom = main_rows[0].nom
            }
          }catch(e){
            _nom = main_rows[0].nom
          }
        }
        else{
          _nom = main_rows[0].nom
        }
      }
      else{
        _nom = cat.nom.get()
      }

      if(main_rows.length < 2){
        _data.nom = typeof _nom == 'string' ? cat.nom.get(_nom) : _nom;
      }
      else{
        // TODO: реализовать фильтр
        _data.nom = _nom;
      }

      return _data.nom;
    }

    /**
     * Возвращает атрибуты характеристики виртуальной продукции по вставке в контур
     */
    contour_attrs(contour) {

      const main_rows = [];
      const res = {calc_order: contour.project.ox.calc_order};

      this.specification.find_rows({is_main_elm: true}, (row) => {
        main_rows.push(row);
        return false;
      });

      if(main_rows.length){
        const irow = main_rows[0],
          sizes = {},
          sz_keys = {},
          sz_prms = ['length', 'width', 'thickness'].map((name) => {
            const prm = job_prm.properties[name];
            sz_keys[prm.ref] = name;
            return prm;
          });

        // установим номенклатуру продукции
        res.owner = irow.nom instanceof $p.CatInserts ? irow.nom.nom() : irow.nom;

        // если в параметрах вставки задействованы свойства длина и или ширина - габариты получаем из свойств
        contour.project.ox.params.find_rows({
          cnstr: contour.cnstr,
          inset: this,
          param: {in: sz_prms}
        }, (row) => {
          sizes[sz_keys[row.param.ref]] = row.value
        });

        if(Object.keys(sizes).length > 0){
          res.x = sizes.length ? (sizes.length + irow.sz) * (irow.coefficient * 1000 || 1) : 0;
          res.y = sizes.width ? (sizes.width + irow.sz) * (irow.coefficient * 1000 || 1) : 0;
          res.s = ((res.x * res.y) / 1000000).round(3);
          res.z = sizes.thickness * (irow.coefficient * 1000 || 1);
        }
        else{
          if(irow.count_calc_method == enm.count_calculating_ways.ПоФормуле && !irow.formula.empty()){
            irow.formula.execute({
              ox: contour.project.ox,
              contour: contour,
              inset: this,
              row_ins: irow,
              res: res
            });
          }
          if(irow.count_calc_method == enm.count_calculating_ways.ПоПлощади && this.insert_type == enm.inserts_types.МоскитнаяСетка){
            // получаем габариты смещенного периметра
            const bounds = contour.bounds_inner(irow.sz);
            res.x = bounds.width.round(1);
            res.y = bounds.height.round(1);
            res.s = ((res.x * res.y) / 1000000).round(3);
          }
          else{
            res.x = contour.w + irow.sz;
            res.y = contour.h + irow.sz;
            res.s = ((res.x * res.y) / 1000000).round(3);
          }
        }
      }

      return res;

    }

    /**
     * Проверяет ограничения вставки или строки вставки
     * @param row {CatInserts|CatInsertsSpecificationRow}
     * @param elm {BuilderElement}
     * @param by_perimetr {Boolean}
     * @param len_angl {Object}
     * @return {Boolean}
     */
    check_restrictions(row, elm, by_perimetr, len_angl) {

      const {_row} = elm;
      const len = len_angl ? len_angl.len : _row.len;
      const is_linear = elm.is_linear ? elm.is_linear() : true;
      let is_tabular = true;

      // проверяем площадь
      if(row.smin > _row.s || (_row.s && row.smax && row.smax < _row.s)){
        return false;
      }

      // Главный элемент с нулевым количеством не включаем
      if(row.is_main_elm && !row.quantity){
        return false;
      }

      // только для прямых или только для кривых профилей
      if((row.for_direct_profile_only > 0 && !is_linear) || (row.for_direct_profile_only < 0 && is_linear)){
        return false;
      }

      if(utils.is_data_obj(row)){

        if(row.impost_fixation == enm.impost_mount_options.ДолжныБытьКрепленияИмпостов){
          if(!elm.joined_imposts(true)){
            return false;
          }
        }
        else if(row.impost_fixation == enm.impost_mount_options.НетКрепленийИмпостовИРам){
          if(elm.joined_imposts(true)){
            return false;
          }
        }
        is_tabular = false;
      }

      if(!is_tabular || by_perimetr || row.count_calc_method != enm.count_calculating_ways.ПоПериметру){
        if(row.lmin > len || (row.lmax < len && row.lmax > 0)){
          return false;
        }
        if(row.ahmin > _row.angle_hor || row.ahmax < _row.angle_hor){
          return false;
        }
      }

      //// Включить проверку размеров и углов, поля "Устанавливать с..." и т.д.

      return true;
    }

    /**
     * Возвращает спецификацию вставки с фильтром
     * @method filtered_spec
     * @param elm {BuilderElement|Object} - элемент, к которому привязана вставка
     * @param ox {CatCharacteristics} - текущая продукция
     * @param [is_high_level_call] {Boolean} - вызов верхнего уровня - специфично для стеклопакетов
     * @param [len_angl] {Object} - контекст размеров элемента
     * @param [own_row] {CatInsertsSpecificationRow} - родительская строка для вложенных вставок
     * @return {Array}
     */
    filtered_spec({elm, is_high_level_call, len_angl, own_row, ox}) {

      const res = [];

      if(this.empty()){
        return res;
      }

      function fake_row(row) {
        if(row._metadata){
          const res = {};
          for(let fld in row._metadata().fields){
            res[fld] = row[fld];
          }
          return res;
        }
        else{
          return Object.assign({}, row);
        }
      }

      const {insert_type, check_restrictions} = this;
      const {Профиль, Заполнение} = enm.inserts_types;
      const {check_params} = ProductsBuilding;

      // для заполнений, можно переопределить состав верхнего уровня
      if(is_high_level_call && (insert_type == Заполнение)){

        const glass_rows = [];
        ox.glass_specification.find_rows({elm: elm.elm, inset: {not: utils.blank.guid}}, (row) => {
          glass_rows.push(row);
        });

        // если спецификация верхнего уровня задана в изделии, используем её, параллельно формируем формулу
        if(glass_rows.length){
          glass_rows.forEach((row) => {
            row.inset.filtered_spec({elm, len_angl, ox, own_row: {clr: row.clr}}).forEach((row) => {
              res.push(row);
            });
          });
          return res;
        }
      }

      this.specification.forEach((row) => {

        // Проверяем ограничения строки вставки
        if(!check_restrictions(row, elm, insert_type == Профиль, len_angl)){
          return;
        }

        // Проверяем параметры изделия, контура или элемента
        if(own_row && row.clr.empty() && !own_row.clr.empty()){
          row = fake_row(row);
          row.clr = own_row.clr;
        }
        if(!check_params({
          params: this.selection_params,
          ox: ox,
          elm: elm,
          row_spec: row,
          cnstr: len_angl && len_angl.cnstr,
          origin: len_angl && len_angl.origin,
        })){
          return;
        }

        // Добавляем или разузловываем дальше
        if(row.nom instanceof $p.CatInserts){
          row.nom.filtered_spec({elm, len_angl, ox, own_row: own_row || row}).forEach((subrow) => {
            const fakerow = fake_row(subrow);
            fakerow.quantity = (subrow.quantity || 1) * (row.quantity || 1);
            fakerow.coefficient = (subrow.coefficient || 1) * (row.coefficient || 1);
            fakerow._origin = row.nom;
            if(fakerow.clr.empty()){
              fakerow.clr = row.clr;
            }
            res.push(fakerow);
          });
        }
        else{
          res.push(row);
        }

      });

      return res;
    }

    /**
     * Дополняет спецификацию изделия спецификацией текущей вставки
     * @method calculate_spec
     * @param elm {BuilderElement}
     * @param len_angl {Object}
     * @param ox {CatCharacteristics}
     * @param spec {TabularSection}
     */
    calculate_spec({elm, len_angl, ox, spec, clr}) {

      const {_row} = elm;
      const {ПоПериметру, ПоШагам, ПоФормуле, ДляЭлемента, ПоПлощади, ДлинаПоПарам, ГабаритыПоПарам} = enm.count_calculating_ways;
      const {profile_items} = enm.elm_types;
      const {new_spec_row, calc_qty_len, calc_count_area_mass} = ProductsBuilding;

      if(!spec){
        spec = ox.specification;
      }

      this.filtered_spec({elm, is_high_level_call: true, len_angl, ox, clr}).forEach((row_ins_spec) => {

        const origin = row_ins_spec._origin || this;
        let {count_calc_method, sz, offsets, coefficient, formula} = row_ins_spec;
        if(!coefficient) {
          coefficient = 0.001;
        }

        let row_spec;

        // добавляем строку спецификации, если профиль или не про шагам
        if((count_calc_method != ПоПериметру && count_calc_method != ПоШагам) || profile_items.indexOf(_row.elm_type) != -1){
          row_spec = new_spec_row({elm, row_base: row_ins_spec, origin, spec, ox});
        }

        if(count_calc_method == ПоФормуле && !formula.empty()){
          // если строка спецификации не добавлена на предыдущем шаге, делаем это сейчас
          row_spec = new_spec_row({row_spec, elm, row_base: row_ins_spec, origin, spec, ox});
        }
        // для вставок в профиль способ расчета количества не учитывается
        else if(profile_items.indexOf(_row.elm_type) != -1 || count_calc_method == ДляЭлемента){
          calc_qty_len(row_spec, row_ins_spec, len_angl ? len_angl.len : _row.len);
        }
        else{

          if(count_calc_method == ПоПлощади){
            row_spec.qty = row_ins_spec.quantity;
            if(this.insert_type == enm.inserts_types.МоскитнаяСетка){
              const bounds = elm.layer.bounds_inner(sz);
              row_spec.len = bounds.height * coefficient;
              row_spec.width = bounds.width * coefficient;
              row_spec.s = (row_spec.len * row_spec.width).round(3);
            }
            else if(this.insert_type == enm.inserts_types.Жалюзи) {
              if(elm.bounds_light) {
                const bounds = elm.bounds_light();
                row_spec.len = (bounds.height + offsets) * coefficient;
                row_spec.width = (bounds.width + sz) * coefficient;
              }
              else {
                row_spec.len = elm.len * coefficient;
                row_spec.width = elm.height * coefficient;
              }
              row_spec.s = (row_spec.len * row_spec.width).round(3);
            }
            else{
              row_spec.len = (_row.y2 - _row.y1 - sz) * coefficient;
              row_spec.width = (_row.x2 - _row.x1 - sz) * coefficient;
              row_spec.s = _row.s;
            }
          }
          else if(count_calc_method == ПоПериметру){
            const row_prm = {_row: {len: 0, angle_hor: 0, s: _row.s}};
            const perimeter = elm.perimeter ? elm.perimeter : (
              this.insert_type == enm.inserts_types.МоскитнаяСетка ? elm.layer.perimeter_inner(sz) : elm.layer.perimeter
            )
            perimeter.forEach((rib) => {
              row_prm._row._mixin(rib);
              row_prm.is_linear = () => rib.profile ? rib.profile.is_linear() : true;
              if(this.check_restrictions(row_ins_spec, row_prm, true)){
                row_spec = new_spec_row({elm, row_base: row_ins_spec, origin, spec, ox});
                // при расчете по периметру, выполняем формулу для каждого ребра периметра
                const qty = !formula.empty() && formula.execute({
                  ox: ox,
                  elm: rib.profile || rib,
                  cnstr: len_angl && len_angl.cnstr || 0,
                  inset: (len_angl && len_angl.hasOwnProperty('cnstr')) ? len_angl.origin : utils.blank.guid,
                  row_ins: row_ins_spec,
                  row_spec: row_spec,
                  clr,
                  len: rib.len
                });
                // если формула не вернула значение, устанавливаем qty_len стандартным способом
                if(qty) {
                  if(!row_spec.qty) {
                    row_spec.qty = qty;
                  }
                }
                else {
                  calc_qty_len(row_spec, row_ins_spec, rib.len);
                }
                calc_count_area_mass(row_spec, spec, _row, row_ins_spec.angle_calc_method);
              }
              row_spec = null;
            });

          }
          else if(count_calc_method == ПоШагам){

            const bounds = this.insert_type == enm.inserts_types.МоскитнаяСетка ?
              elm.layer.bounds_inner(sz) : {height: _row.y2 - _row.y1, width: _row.x2 - _row.x1};

            const h = (!row_ins_spec.step_angle || row_ins_spec.step_angle == 180 ? bounds.height : bounds.width);
            const w = !row_ins_spec.step_angle || row_ins_spec.step_angle == 180 ? bounds.width : bounds.height;
            if(row_ins_spec.step){
              let qty = 0;
              let pos;
              if(row_ins_spec.do_center && h >= row_ins_spec.step ){
                pos = h / 2;
                if(pos >= offsets &&  pos <= h - offsets){
                  qty++;
                }
                for(let i = 1; i <= Math.ceil(h / row_ins_spec.step); i++){
                  pos = h / 2 + i * row_ins_spec.step;
                  if(pos >= offsets &&  pos <= h - offsets){
                    qty++;
                  }
                  pos = h / 2 - i * row_ins_spec.step;
                  if(pos >= offsets &&  pos <= h - offsets){
                    qty++;
                  }
                }
              }
              else{
                for(let i = 1; i <= Math.ceil(h / row_ins_spec.step); i++){
                  pos = i * row_ins_spec.step;
                  if(pos >= offsets &&  pos <= h - offsets){
                    qty++;
                  }
                }
              }

              if(qty){
                row_spec = new_spec_row({elm, row_base: row_ins_spec, origin, spec, ox});
                calc_qty_len(row_spec, row_ins_spec, w);
                row_spec.qty *= qty;
                calc_count_area_mass(row_spec, spec, _row, row_ins_spec.angle_calc_method);
              }
              row_spec = null;
            }
          }
          else if(count_calc_method == ДлинаПоПарам){
            let len = 0;
            this.selection_params.find_rows({elm: row_ins_spec.elm}, ({param}) => {
              if(param.type.digits) {
                ox.params.find_rows({cnstr: 0, param}, ({value}) => {
                  len = value;
                  return false;
                });
              };
              if(len) return false;
            });

            row_spec.qty = row_ins_spec.quantity;
            row_spec.len = (len - sz) * coefficient;
            row_spec.width = 0;
            row_spec.s = 0;
          }
          else if(count_calc_method == ГабаритыПоПарам){
            let len = 0, width = 0;
            this.selection_params.find_rows({elm: row_ins_spec.elm}, ({param}) => {
              if(param.type.digits) {
                ox.params.find_rows({cnstr: 0, param}, ({value}) => {
                  if(!len) {
                    len = value;
                  }
                  else if(!width) {
                    width = value;
                  }
                  return false;
                });
              };
              if(len && width) return false;
            });
            row_spec.qty = row_ins_spec.quantity;
            row_spec.len = (len - sz) * coefficient;
            row_spec.width = (width - sz) * coefficient;
            row_spec.s = (row_spec.len * row_spec.width).round(3);
          }
          else{
            throw new Error("count_calc_method: " + row_ins_spec.count_calc_method);
          }
        }

        if(row_spec){
          // выполняем формулу
          if(!formula.empty()){
            const qty = formula.execute({
              ox: ox,
              elm: elm,
              cnstr: len_angl && len_angl.cnstr || 0,
              inset: (len_angl && len_angl.hasOwnProperty('cnstr')) ? len_angl.origin : utils.blank.guid,
              row_ins: row_ins_spec,
              row_spec: row_spec,
              clr,
              len: len_angl ? len_angl.len : _row.len
            });
            if(count_calc_method == ПоФормуле){
              row_spec.qty = qty;
            }
            else if(formula.condition_formula && !qty){
              row_spec.qty = 0;
            }
          }
          calc_count_area_mass(row_spec, spec, _row, row_ins_spec.angle_calc_method);
        }
      });

      // скорректируем габариты вытягиваемой конструкции
      if(spec !== ox.specification && this.insert_type == enm.inserts_types.Жалюзи) {
        const bounds = {x: 0, y: 0};
        spec.forEach(({len, width}) => {
          if(len && width) {
            if(bounds.x < len) {
              bounds.x = len;
            }
            if(bounds.y < width) {
              bounds.y = width;
            }
          }
        });
        const {_owner} = spec;
        _owner.x = bounds.y * 1000;
        _owner.y = bounds.x * 1000;
        _owner.s = (bounds.x * bounds.y).round(3);
      }
    }

    /**
     * Возвращает толщину вставки
     *
     * @property thickness
     * @return {Number}
     */
    get thickness() {

      const {_data} = this;

      if(!_data.hasOwnProperty("thickness")){
        _data.thickness = 0;
        const nom = this.nom(null, true);
        if(nom && !nom.empty()){
          _data.thickness = nom.thickness;
        }
        else{
          this.specification.forEach(({nom}) => {
            if(nom) {
              _data.thickness += nom.thickness;
            }
          });
        }
      }

      return _data.thickness;
    }

    /**
     * Возвращает массив задействованных во вставке параметров
     * @property used_params
     * @return {Array}
     */
    get used_params() {
      const res = [];
      this.selection_params.forEach(({param}) => {
        if(!param.empty() && res.indexOf(param) == -1){
          res.push(param)
        }
      });
      this.product_params.forEach(({param}) => {
        if(!param.empty() && res.indexOf(param) == -1){
          res.push(param)
        }
      });
      return res;
    }

  }

})($p);

