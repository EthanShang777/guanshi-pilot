const sectorFilter = (() => {
  const taxonomy = /* TAXONOMY */ null;
  const {roots, branches, aliases, parents, directionAliases, directions} = taxonomy;
  const rootIds = new Map(Object.entries(roots).map(([id,label])=>[label,id]));
  const branchIds = new Map(Object.entries(branches).map(([id,label])=>[label,id]));
  const get=(items,key)=>Object.hasOwn(items,key)?items[key]:'';
  function resolve(sector='', sub='') {
    sector=sector.normalize('NFKC').trim();sub=sub.normalize('NFKC').trim();
    const branch=branchIds.get(sector)||(Object.hasOwn(branches,sector)?sector:'');
    const root=branch?parents[branch]:rootIds.get(sector)||
      (Object.hasOwn(roots,sector)?sector:get(aliases,sector));
    const direction=get(directionAliases,sub)||get(directions,sub)||get(branches,sub)||sub;
    return {
      sector: get(roots,root)||sector,
      sub: direction||get(branches,branch)
    };
  }
  function matches(request, sector, sub, membership=[]) {
    if(request.sector && request.sector!==sector)return false;
    if(!request.sub)return true;
    const branch=branchIds.get(request.sub);
    return request.sub===sub||!!branch&&membership.includes(branch);
  }
  function setValue(select, value, label=value) {
    if(value && !Array.from(select.options).some(option=>option.value===value))select.add(new Option(label,value));
    select.value=value;
  }
  return { resolve, matches, setValue, branchLabel: id=>get(branches,id) };
})();
