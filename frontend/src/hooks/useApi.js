import { useState, useEffect, useCallback } from 'react'

const API_BASE = '/api'

async function fetchJSON(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

export function useApi(endpoint, initialData = null, deps = []) {
  const [data, setData] = useState(initialData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await fetchJSON(endpoint)
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [endpoint, ...deps])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

export function usePostApi(endpoint) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const post = useCallback(async (body) => {
    try {
      setLoading(true)
      setError(null)
      const result = await fetchJSON(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
      })
      return result
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  return { post, loading, error }
}

export function useDashboard() {
  return useApi('/dashboard/summary')
}

export function useIterations() {
  return useApi('/iterations')
}

export function useIteration(id) {
  return useApi(`/iterations/${id}`, null, [id])
}

export function useCases(params = {}) {
  const queryString = new URLSearchParams(params).toString()
  const endpoint = `/cases${queryString ? `?${queryString}` : ''}`
  return useApi(endpoint)
}

export function useCase(id) {
  return useApi(`/cases/${id}`)
}

export function useCaseReasoning(id) {
  return useApi(`/cases/${id}/reasoning`)
}

export function usePerceptionCurrent() {
  return useApi('/perception/current')
}

export function useEvaluatorSuggestions() {
  return useApi('/evaluator/suggestions')
}

export function useSkillDiffs() {
  return useApi('/skills/diffs')
}
