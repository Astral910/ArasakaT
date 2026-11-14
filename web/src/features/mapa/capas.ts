// Fuentes de teselas del mapa (sin llaves): relieve AWS Terrain Tiles (SRTM y otros), NASA GIBS, Sentinel-2 de EOX.

export const DEM = {
  type: 'raster-dem' as const,
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium' as const,
  tileSize: 256,
  maxzoom: 12,
  attribution: 'Terrain: AWS Terrain Tiles (SRTM, NASA/USGS)',
}

export const SATELITE = {
  type: 'raster' as const,
  tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
  tileSize: 256,
  maxzoom: 14,
  attribution: 'Sentinel-2 cloudless 2020 by EOX (contains modified Copernicus Sentinel data)',
}

export type CapaRayos = 'ndvi' | 'lluvia'

/** URL de teselas de NASA GIBS para el año y mes escogidos (NDVI mensual de MODIS Terra o lluvia diaria de IMERG). */
export function gibs(capa: CapaRayos, anio: number, mes: number, dia = 15) {
  const mm = String(mes).padStart(2, '0')
  if (capa === 'ndvi') {
    return {
      capa: 'MODIS_Terra_L3_NDVI_Monthly',
      fecha: `${anio}-${mm}-01`,
      url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L3_NDVI_Monthly/default/${anio}-${mm}-01/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`,
      maxzoom: 7,
    }
  }
  const dd = String(dia).padStart(2, '0')
  return {
    capa: 'IMERG_Precipitation_Rate',
    fecha: `${anio}-${mm}-${dd}`,
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/${anio}-${mm}-${dd}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    maxzoom: 6,
  }
}

/** Límites de Guatemala para encuadrar. */
export const GT: [[number, number], [number, number]] = [[-92.3, 13.7], [-88.2, 17.85]]
