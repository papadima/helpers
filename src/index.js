import vkConnect from '@vkontakte/vk-connect'
import { AllHtmlEntities } from 'html-entities'
import RichError from 'luna-rich-error'

const entities = new AllHtmlEntities()

export const parseURLQuery = (str) => {
  if (typeof str !== 'string' || !str.length) {
    return {}
  }

  const s = str.split('&')
  const query = {}
  let bit
  let first
  let second

  for (let i = 0; i < s.length; i++) {
    bit = s[i].split('=')
    first = decodeURIComponent(bit[0])

    if (first.length && (first.startsWith('vk_') || first === 'sign')) {
      second = decodeURIComponent(bit[1])
      if (typeof query[first] === 'undefined') {
        query[first] = second
      } else if (Array.isArray(query[first])) {
        query[first].push(second)
      } else {
        query[first] = [query[first], second]
      }
    }
  }

  return query
}
export const stringifyURLQuery = (params) => {
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((r, k) => ({ ...r, [k]: params[k] }), {})
  const searchParameters = new URLSearchParams()

  Object.keys(sortedParams)
    .forEach((parameterName) => {
      searchParameters.append(parameterName, sortedParams[parameterName])
    })

  return searchParameters.toString()
}
export const replaceSubstr = (...args) => {
  let [s, p, r] = args || []

  return !!s && {
    2: () => {
      for (const i in p) {
        s = replaceSubstr(s, i, p[i])
      }
      return s
    },
    3: () => s.replace(new RegExp(`[${p}]`, 'g'), r),
    0: () => false
  }[args.length]()
}
export const unescapeHtmlChars = (v = '') => entities.decode(v)
export const unescapeHtmlCharsFromVkGeoData = d => ({
  ...d,
  title: d.title ? unescapeHtmlChars(d.title) : d.title
})
export const unescapeHtmlCharsFromVkUserData = d => ({
  ...d,
  first_name: d.first_name ? unescapeHtmlChars(d.first_name) : d.first_name,
  last_name: d.last_name ? unescapeHtmlChars(d.last_name) : d.last_name,
  city: typeof d.city === 'object' ? unescapeHtmlCharsFromVkGeoData(d.city) : d.city,
  country: typeof d.country === 'object' ? unescapeHtmlCharsFromVkGeoData(d.country) : d.country
})
export const getNumDescription = (n, textForms) => {
  const num = Math.abs(n) % 100
  const num1 = num % 10

  if (num > 10 && num < 20) {
    return textForms[2]
  }
  if (num1 > 1 && num1 < 5) {
    return textForms[1]
  }
  if (num1 === 1) {
    return textForms[0]
  }
  return textForms[2]
}
export const getAgeDescription = n => getNumDescription(n, ['год', 'года', 'лет'])
export const getAge = birthDate => Math.trunc((new Date() - new Date(birthDate)) / (1000 * 60 * 60 * 24 * 365.245))

export const getVkToken = async ({ appId, scopeList = [] }) => {
  let result

  try {
    result = await vkConnect.sendPromise('VKWebAppGetAuthToken', { app_id: appId, scope: scopeList.join() })
  } catch (error) {
    if (typeof error === 'object') {
      if (error.error_data && error.error_data.error_code && error.error_data.error_code === 4) {
        throw new RichError('Запрос на предоставление доступов был отклонен.', 423, RichError.codes.REJECTED_SCOPES_REQUEST)
      }
    }
    throw new RichError('Произошла ошибка во время получения токена VK.')
  }

  if (scopeList.length && (!result.scope || result.scope.split(',').length < scopeList.length)) {
    throw new RichError('Количество отмеченных доступов меньше ожидаемого.', 416, RichError.codes.INSUFFICIENT_SCOPES_RANGE)
  }

  return result.access_token
}
export const searchVkCountries = async ({ vkToken, value }) => {
  let response

  try {
    ({ response } = await vkConnect.sendPromise('VKWebAppCallAPIMethod', {
      method: 'database.getCountries',
      params: {
        need_all: 1,
        count: 1000,
        v: '5.102',
        lang: 'ru',
        access_token: vkToken
      }
    }))
  } catch (error) {
    throw error
  }

  return response.items
    .filter(c => c.title.toLowerCase()
      .startsWith(value))
    .map(({ id, title }) => ({ value: unescapeHtmlChars(title), vkFieldId: id }))
}
export const searchVkCities = async ({
  vkToken,
  value,
  vkCountryId
}) => {
  let response

  try {
    ({ response } = await vkConnect.sendPromise('VKWebAppCallAPIMethod', {
      method: 'database.getCities',
      params: {
        country_id: vkCountryId,
        q: value,
        need_all: 1,
        count: 1000,
        v: '5.102',
        lang: 'ru',
        access_token: vkToken
      }
    }))
  } catch (error) {
    throw error
  }

  return response.items.map(({
    id,
    title,
    region
  }) => ({
    value: unescapeHtmlChars(title),
    vkFieldId: id,
    region: unescapeHtmlChars(region)
  }))
}
export const executeVkApiMethods = async ({
  vkToken,
  vkCountryIds,
  vkCityIds,
  vkUserIds,
  vkGroupsOfUserId,
  vkPhotosOfUserId
}) => {
  const entityReducer = [(r, c) => ({ ...r, [c.id]: unescapeHtmlChars(c.title) }), {}]
  const photosMapper = ({ sizes }) => {
    let currentSize = { height: 0 }

    sizes.forEach((s) => {
      if (s.height >= currentSize.height && s.height <= 1000) {
        currentSize = s
      }
    })

    return currentSize.url
  }
  let response

  try {
    ({ response } = await vkConnect.sendPromise('VKWebAppCallAPIMethod', {
      method: 'execute',
      params: {
        code: `
          return {
            ${vkCountryIds ? `
              countries: API.database.getCountriesById({
                country_ids: '${vkCountryIds.join(',')}',
                v: '5.102'
              }),
            ` : ''}
            ${vkCityIds ? `
              cities: API.database.getCitiesById({
                city_ids: '${vkCityIds.join(',')}',
                v: '5.102'
              }),
            ` : ''}
            ${vkUserIds ? `
              users: API.users.get({
                user_ids: '${vkUserIds.join(',')}',
                fields: 'timezone,about,sex,city,country,bdate,photo_200,photo_max_orig',
                v: '5.102'
              }),
            ` : ''}
            ${vkGroupsOfUserId ? `
              groups: API.groups.get({
                user_id: ${vkGroupsOfUserId},
                v: '5.102'
              }),
            ` : ''}
          };
        `,
        access_token: vkToken,
        lang: 'ru',
        v: '5.102'
      }
    }))
    if (vkPhotosOfUserId) {
      response.photos = await new Promise((resolve, reject) => {
        setTimeout(async () => {
          let vkApiPhotosData

          try {
            vkApiPhotosData = await vkConnect.sendPromise('VKWebAppCallAPIMethod', {
              method: 'photos.get',
              params: {
                owner_id: vkPhotosOfUserId,
                album_id: 'profile',
                rev: 1,
                count: 10,
                v: '5.102',
                lang: 'ru',
                access_token: vkToken
              }
            })
          } catch (error) {
            if (error.error_data && !error.error_data.error_reason) {
              if (error.error_data.error_code === 30) {
                return resolve({ items: [] })
              }
              return reject(new RichError(error.error_data.error_msg))
            }
            if (error.error_data && error.error_data.error_reason) {
              if (error.error_data.error_reason.error_code === 30) {
                return resolve({ items: [] })
              }
              return reject(new RichError(error.error_data.error_reason.error_msg))
            }
            return reject(new RichError('Ошибка при получении фотографий из VK'))
          }
          return resolve(vkApiPhotosData.response)
        }, 1000)
      })
    }
  } catch (error) {
    throw error
  }

  return {
    vkCountriesById: vkCountryIds && response.countries.reduce(...entityReducer),
    vkCitiesById: vkCityIds && response.cities.reduce(...entityReducer),
    vkUsers: vkUserIds && response.users.map(unescapeHtmlCharsFromVkUserData),
    vkGroups: vkGroupsOfUserId && response.groups.items,
    vkPhotos: vkPhotosOfUserId && response.photos.items.map(photosMapper)
  }
}
export const getVkImagesNativeViewer = ({ images, startIndex }) => {
  return vkConnect.sendPromise('VKWebAppShowImages', { images, start_index: startIndex })
}
export const getInitialVkUserData = async () => {
  let result

  try {
    result = await vkConnect.sendPromise('VKWebAppGetUserInfo', {
      params: { lang: 'ru' }
    })
  } catch (error) {
    throw error
  }

  return unescapeHtmlCharsFromVkUserData(result)
}
export const repostToVkWall = ({ message, attachments }) => {
  return vkConnect.sendPromise('VKWebAppShowWallPostBox', {
    message,
    attachments,
    v: '5.102',
    close_comments: 1
  })
}
export const askForVkNotificationsSending = async () => {
  let result

  try {
    result = await vkConnect.sendPromise('VKWebAppAllowNotifications', {})
  } catch (error) {
    result = { result: false }
  }

  return result
}
export const openVkPayWindow = async ({
  amount,
  description,
  appId,
  sign,
  merchantId,
  merchantData,
  merchantSign,
  orderId,
  ts
}) => {
  const action = 'pay-to-service'
  const generalErrorMessage = 'Во время оплаты произошла ошибка. Попробуйте еще раз, пожалуйста.'
  let result

  try {
    ({ result } = await vkConnect.sendPromise('VKWebAppOpenPayForm', {
      app_id: appId,
      action,
      params: {
        amount,
        description,
        action,
        merchant_id: merchantId,
        version: 2,
        sign,
        data: {
          currency: 'RUB',
          merchant_data: merchantData,
          merchant_sign: merchantSign,
          order_id: orderId,
          ts
        }
      }
    }))
  } catch (error) {
    throw new RichError(generalErrorMessage)
  }

  if (!result.status) {
    throw new RichError(generalErrorMessage)
  }

  return true
}

export const authorizeUserByVkParams = async (axInstance, reqData = {}) => {
  let response

  try {
    response = await axInstance.post('/users/authenticate', reqData)
  } catch (error) {
    throw error.response.data
  }

  return response.data
}
export const createUserByVkParams = async (axInstance, userData = {}) => {
  const response = await axInstance.post('/users/register', userData)

  return response.data
}
export const synchronizeVkData = async (axInstance, userData) => {
  const response = await axInstance.post('/users/synchronize-vk-data', { data: userData })

  return response.data
}
export const updateUser = async (axInstance, { newData }) => {
  const response = await axInstance.put('/users', newData)

  return response.data
}
export const deleteUser = async (axInstance) => {
  const response = await axInstance.delete('/users')

  return response.data
}
export const setAnswerToOffer = async (axInstance, { offer, answer }) => {
  const offerAnswerResponse = await axInstance.post(`/offers/${offer}/answer`, { answer })

  return offerAnswerResponse.data
}
export const checkExistingOrder = async (axInstance) => {
  const recentOrderResponse = await axInstance.get('/orders/recent')

  return recentOrderResponse.data
}
export const createOrder = async (axInstance, orderData = {}) => {
  const newOrderResponse = await axInstance.post('/orders', orderData)

  return newOrderResponse.data
}
export const continueOrder = async (axInstance, { orderId }) => {
  const orderResponse = await axInstance.post('/orders', { orderId })

  return orderResponse.data
}
export const updateOrderStatus = async (axInstance, { orderId, status }) => {
  const orderResponse = await axInstance.put(`/orders/${orderId}`, { status })

  return orderResponse.data
}
export const sendComplaint = async (axInstance, reqData = {}) => {
  const response = await axInstance.post('/complaints', reqData)

  return response.data
}

export default {
  parseURLQuery,
  stringifyURLQuery,
  replaceSubstr,
  unescapeHtmlChars,
  unescapeHtmlCharsFromVkGeoData,
  unescapeHtmlCharsFromVkUserData,
  getNumDescription,
  getAgeDescription,
  getAge,
  getVkToken,
  searchVkCountries,
  searchVkCities,
  executeVkApiMethods,
  getVkImagesNativeViewer,
  getInitialVkUserData,
  repostToVkWall,
  askForVkNotificationsSending,
  openVkPayWindow,
  authorizeUserByVkParams,
  createUserByVkParams,
  synchronizeVkData,
  updateUser,
  deleteUser,
  setAnswerToOffer,
  checkExistingOrder,
  createOrder,
  continueOrder,
  updateOrderStatus,
  sendComplaint
}
